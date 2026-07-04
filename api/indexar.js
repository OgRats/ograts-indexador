const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const contratoOgRats = "0x953E34637cC596B8195Eb7FB83305402d3B9D000";

export default async function handler(req, res) {
    try {
        const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

        console.log("⏳ Conectando con nodo público Ronin...");
        
        // Cambiamos a un nodo público abierto que no requiere API Key (código 401)
        const urlRonin = "https://ronin.api.slingshot.finance/v1/rpc";

        const response = await fetch(urlRonin, {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "eth_call",
                params: [
                    {
                        to: contratoOgRats,
                        data: "0x70a0823100000000000000000000000000000000000000000000000000000000" 
                    },
                    "latest"
                ]
            })
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
