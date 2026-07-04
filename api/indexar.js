const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;
const contratoOgRats = "0x953E34637cC596B8195Eb7FB83305402d3B9D000";

export default async function handler(req, res) {
    try {
        const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

        if (!OPENSEA_API_KEY) {
            throw new Error("Falta la variable OPENSEA_API_KEY en Vercel");
        }

        console.log("⏳ Consultando holders reales y nombres en OpenSea...");
        
        // Consultamos la API de OpenSea para la red de Ronin
        const urlOpenSea = `https://api.opensea.io/api/v2/chain/ronin/contract/${contratoOgRats}/owners?limit=100`;

        const responseOS = await fetch(urlOpenSea, {
            method: "GET",
            headers: { 
                "Accept": "application/json",
                "X-API-KEY": OPENSEA_API_KEY
            }
        });

        if (!responseOS.ok) {
            throw new Error(`OpenSea API respondió con código ${responseOS.status}`);
        }

        const jsonOS = await responseOS.json();
        const owners = jsonOS.owners || [];
        
        let snapshotActual = {};

        // Recorremos los datos reales de OpenSea
        owners.forEach(item => {
            const wallet = item.address.toLowerCase();
            // OpenSea nos da la cantidad exacta de NFTs de esta colección que tiene la wallet
            const cantidadNfts = parseInt(item.quantity || 1);
            
            // Intentamos sacar el nombre de usuario de OpenSea si existe, si no, se queda vacío
            const nickname = item.username || "";

            if (wallet && wallet !== "0x0000000000000000000000000000000000000000") {
                snapshotActual[wallet] = {
                    balance: cantidadNfts,
                    username: nickname
                };
            }
        });

        if (Object.keys(snapshotActual).length === 0) {
            throw new Error("No se encontraron dueños en los datos de OpenSea.");
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

        // 3. Preparar filas acumulando 1 punto por cada NFT holdeado
        const filasAInsertar = Object.keys(snapshotActual).map(wallet => {
            const info = snapshotActual[wallet];
            const puntosViejos = historialPuntos[wallet] || 0;
            
            return {
                address: wallet,
                username: info.username, // Guardamos el nombre real del perfil
                balance: info.balance,    // Guardamos cuántos NFTs tiene exactamente
                puntos: puntosViejos + info.balance, // Suma 1 punto por cada NFT acumulado en esta ejecución
                updated_at: new Date().toISOString()
            };
        });

        // 4. Guardar todo en Supabase
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

        if (!resInsert.ok) throw new Error("Error guardando datos reales en Supabase");

        return res.status(200).json({ 
            success: true, 
            message: `¡Clasificación real sincronizada! Sincronizados ${filasAInsertar.length} holders con sus nombres y balances.` 
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
