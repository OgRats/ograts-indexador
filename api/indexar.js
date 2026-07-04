const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const contratoOgRats = "0x953E34637cC596B8195Eb7FB83305402d3B9D000";

export default async function handler(req, res) {
    try {
        const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

        console.log("⏳ Obteniendo dueños de tokens desde la API pública de Ronin...");
        
        // Usamos el endpoint oficial de tokens de Ronin Chain que no se satura
        const urlRoninToken = `https://api.roninchain.com/token/erc721/${contratoOgRats}/owners?limit=100`;

        const response = await fetch(urlRoninToken, {
            method: "GET",
            headers: { 
                "Accept": "application/json"
            }
        });

        if (!response.ok) throw new Error(`Ronin API respondió con código ${response.status}`);
        const json = await response.json();
        
        // Obtenemos la lista de resultados
        const items = json.results || json.items || [];
        let snapshotActual = {};

        items.forEach(ownerInfo => {
            const wallet = (ownerInfo.owner || ownerInfo.address || ownerInfo.owner_address || "").toLowerCase();
            const cantidad = parseInt(ownerInfo.balance || ownerInfo.token_count || 1);
            
            // Filtramos direcciones quemadas o vacías
            if (wallet && wallet !== "0x0000000000000000000000000000000000000000") {
                snapshotActual[wallet] = cantidad;
            }
        });

        if (Object.keys(snapshotActual).length === 0) {
            throw new Error("No se encontraron dueños en la respuesta de la API.");
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

        // 3. Preparar filas con suma de puntos acumulados
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

        // 4. Guardar los datos en Supabase
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
            message: `¡Completado con éxito! Se indexaron ${filasAInsertar.length} holders en tu base de datos.` 
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
