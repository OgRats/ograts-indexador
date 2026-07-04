const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const contratoOgRats = "0x953E34637cC596B8195Eb7FB83305402d3B9D000";

export default async function handler(req, res) {
    try {
        const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

        console.log("⏳ Conectando con la API oficial de Ronin Chain...");
        
        // Vercel usa IPs limpias, por lo que el nodo de Ronin nos responderá a la primera
        const urlRonin = `https://app.roninchain.com/api/token/nft/${contratoOgRats}/holders?limit=50`;

        const response = await fetch(urlRonin, {
            method: "GET",
            headers: { 
                "Accept": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
            }
        });

        if (!response.ok) {
            throw new Error(`Ronin Network respondió con código ${response.status}`);
        }

        const json = await response.json();
        const items = json.items || json.results || [];
        
        let snapshotActual = {};
        items.forEach(ownerInfo => {
            const wallet = (ownerInfo.owner || ownerInfo.address || ownerInfo.ownerAddress || "").toLowerCase();
            const cantidad = parseInt(ownerInfo.balance || ownerInfo.tokenCount || 1);
            if (wallet && wallet !== "0x0000000000000000000000000000000000000000") {
                snapshotActual[wallet] = cantidad;
            }
        });

        if (Object.keys(snapshotActual).length === 0) {
            throw new Error("No se encontraron holders en la respuesta.");
        }

        // 2. Consultar historial en Supabase
        const resPrevia = await fetch(`${SUPABASE_URL}/rest/v1/ograts_holders?select=address,puntos`, {
            method: "GET",
            headers: { "apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }
        });

        const datosViejos = resPrevia.ok ? await resPrevia.json() : [];
        const historialPuntos = {};
        datosViejos.forEach(row => {
            if (row.address) historialPuntos[row.address.toLowerCase()] = row.puntos || 0;
        });

        // 3. Procesar incrementos de puntos
        const filasAInsertar = Object.keys(snapshotActual).map(wallet => {
            const nftsHoy = snapshotActual[wallet];
            const puntosViejos = historialPuntos[wallet] || 0;
            return {
                address: wallet,
                balance: nftsHoy,
                puntos: puntosViejos + nftsHoy,
                updated_at: new Date().toISOString()
            };
        });

        // 4. Guardar en Supabase
        const resInsert = await fetch(`${SUPABASE_URL}/rest/v1/ograts_holders`, {
            method: "POST",
            headers: {
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates"
            },
            body: JSON.stringify(filasAInsertar)
        });

        if (!resInsert.ok) throw new Error("Error escribiendo datos en Supabase");

        return res.status(200).json({ 
            success: true, 
            message: `Leaderboard actualizado con ${filasAInsertar.length} holders en el Top.` 
        });

    } catch (error) {
        console.error("❌ Error:", error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
}

