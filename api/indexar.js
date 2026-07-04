const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;
const contratoOgRats = "0x953e34637cc596b8195eb7fb83305402d3b9d000";

export default async function handler(req, res) {
    try {
        const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

        if (!OPENSEA_API_KEY) {
            throw new Error("Falta la variable OPENSEA_API_KEY en Vercel");
        }

        // Parámetro para controlar qué lote de tokens indexar (?desde=1)
        const desde = parseInt(req.query.desde) || 1;
        const limite = 40; // Cantidad de tokens por consulta para evitar bloqueos
        const hasta = desde + limite - 1;

        console.log(`⏳ Extrayendo dueños reales desde el token #${desde} al #${hasta}...`);
        let snapshotActual = {};

        // Consultamos uno por uno los dueños de este lote en OpenSea
        for (let id = desde; id <= hasta; id++) {
            const url = `https://api.opensea.io/api/v2/chain/ronin/contract/${contratoOgRats}/nfts/${id}`;
            
            const response = await fetch(url, {
                method: "GET",
                headers: { "Accept": "application/json", "X-API-KEY": OPENSEA_API_KEY }
            });

            if (response.ok) {
                const nftData = await response.json();
                // Buscamos la billetera del dueño del token
                const wallet = (nftData.nft?.owner || nftData.nft?.owners?.[0]?.address || "").toLowerCase();
                const username = nftData.nft?.owner?.username || null;

                if (wallet && wallet !== "0x0000000000000000000000000000000000000000") {
                    if (!snapshotActual[wallet]) {
                        snapshotActual[wallet] = { balance: 0, username: username };
                    }
                    snapshotActual[wallet].balance += 1;
                }
            }
            // Pequeña pausa para respetar los límites de la API de OpenSea
            await new Promise(resolve => setTimeout(resolve, 150));
        }

        const totalWalletsEncontradas = Object.keys(snapshotActual).length;
        if (totalWalletsEncontradas === 0) {
            throw new Error("No se localizaron dueños activos en este rango de tokens.");
        }

        // Mapeamos los datos para guardarlos en Supabase
        const filasAInsertar = Object.keys(snapshotActual).map(wallet => {
            const info = snapshotActual[wallet];
            return {
                address: wallet,
                username: info.username,
                balance: info.balance,
                puntos: info.balance, // 1 NFT = 1 Punto
                updated_at: new Date().toISOString()
            };
        });

        // Insertamos o actualizamos los balances acumulados
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

        if (!resInsert.ok) {
            const txtErr = await resInsert.text();
            throw new Error(`Supabase rechazó guardar los datos: ${txtErr}`);
        }

        return res.status(200).json({
            success: true,
            message: `¡Lote indexado con éxito! Analizados tokens del ${desde} al ${hasta}.`,
            holders_encontrados: totalWalletsEncontradas,
            siguiente_lote: `?desde=${hasta + 1}`
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
