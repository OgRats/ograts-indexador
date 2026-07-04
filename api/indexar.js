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

        // Controlamos el rango por URL. Ej: /api/indexar?desde=1
        const desde = parseInt(req.query.desde) || 1;
        const limite = 12; // Lote pequeño para ganarle al Timeout de Vercel
        const hasta = desde + limite - 1;

        console.log(`⏳ Analizando dueños reales desde token #${desde} hasta #${hasta}...`);
        let snapshotActual = {};

        // Peticiones individuales controladas
        for (let id = desde; id <= hasta; id++) {
            const url = `https://api.opensea.io/api/v2/chain/ronin/contract/${contratoOgRats}/nfts/${id}`;
            
            const response = await fetch(url, {
                method: "GET",
                headers: { "Accept": "application/json", "X-API-KEY": OPENSEA_API_KEY }
            });

            if (response.ok) {
                const nftData = await response.json();
                
                // Estructura exacta validada por tu captura anterior
                const ownerObj = nftData.nft?.owner;
                const wallet = (typeof ownerObj === 'string' ? ownerObj : ownerObj?.address || "") .toLowerCase();
                const username = ownerObj?.username || null;

                if (wallet && wallet !== "0x0000000000000000000000000000000000000000") {
                    if (!snapshotActual[wallet]) {
                        snapshotActual[wallet] = { balance: 0, username: username };
                    }
                    snapshotActual[wallet].balance += 1;
                }
            }
            // Pausa milimétrica para evitar baneos de Rate Limit
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        const totalWallets = Object.keys(snapshotActual).length;
        if (totalWallets === 0) {
            return res.status(200).json({
                success: true,
                message: `Lote analizado (${desde}-${hasta}), pero no se encontraron transacciones activas en este fragmento.`
            });
        }

        // Preparación limpia de datos para tu Supabase
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

        // Inserción acumulativa con merge de duplicados
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
            throw new Error(`Supabase rechazó guardar: ${txtErr}`);
        }

        return res.status(200).json({
            success: true,
            message: `¡Lote verificado e insertado correctamente en Supabase!`,
            rango_analizado: `${desde} al ${hasta}`,
            owners_reales_detectados: totalWallets,
            siguiente_lote_url: `https://ograts-indexador.vercel.app/api/indexar?desde=${hasta + 1}`
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
