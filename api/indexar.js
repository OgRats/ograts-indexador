const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;
const contratoOgRats = "0x953E34637cC596B8195Eb7FB83305402d3B9D000";

export default async function handler(req, res) {
    try {
        const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

        if (!OPENSEA_API_KEY) {
            throw new Error("Falta la variable OPENSEA_API_KEY en Vercel (Production)");
        }

        console.log("⏳ Descargando holders reales desde el endpoint de contrato de OpenSea...");
        
        // Endpoint v2 correcto para contratos en Ronin que sí incluye los owners e información de cuenta
        const urlOpenSea = `https://api.opensea.io/api/v2/chain/ronin/contract/${contratoOgRats}/nfts?limit=50`;
        
        const responseOS = await fetch(urlOpenSea, {
            method: "GET",
            headers: { 
                "Accept": "application/json",
                "X-API-KEY": OPENSEA_API_KEY
            }
        });

        if (!responseOS.ok) {
            throw new Error(`OpenSea API respondió con código: ${responseOS.status}`);
        }

        const jsonOS = await responseOS.json();
        const nfts = jsonOS.nfts || [];
        
        if (nfts.length === 0) {
            throw new Error("OpenSea no devolvió ítems para este contrato. Verifica el estado de indexación en la plataforma.");
        }

        let snapshotActual = {};

        // Mapeamos los campos de dueños que este endpoint específico sí retorna
        nfts.forEach(nft => {
            let walletDetectada = null;
            let usernameDetectado = null;

            if (nft.owner) {
                walletDetectada = typeof nft.owner === 'string' ? nft.owner : (nft.owner.address || nft.owner.wallet);
                usernameDetectado = nft.owner.username || null;
            } else if (nft.owners && nft.owners.length > 0) {
                walletDetectada = nft.owners[0].address;
                usernameDetectado = nft.owners[0].username || null;
            }

            if (walletDetectada) {
                const walletLimpia = walletDetectada.toLowerCase();
                if (walletLimpia !== "0x0000000000000000000000000000000000000000") {
                    if (!snapshotActual[walletLimpia]) {
                        snapshotActual[walletLimpia] = {
                            balance: 0,
                            username: usernameDetectado || null
                        };
                    }
                    snapshotActual[walletLimpia].balance += 1;
                }
            }
        });

        if (Object.keys(snapshotActual).length === 0) {
            throw new Error("Este endpoint no retornó información de owners mapeable.");
        }

        // Estructuramos las filas idénticas para Supabase
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

        // Upsert limpio en Supabase
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
            throw new Error(`Supabase rechazó la inserción: ${txtErr}`);
        }

        return res.status(200).json({ 
            success: true, 
            message: "¡Sincronización real completada con éxito!",
            holders_actualizados: filasAInsertar.length
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
