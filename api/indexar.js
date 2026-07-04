const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;

export default async function handler(req, res) {
    try {
        const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

        if (!OPENSEA_API_KEY) {
            throw new Error("Falta la variable OPENSEA_API_KEY en Vercel (Production)");
        }

        console.log("⏳ Descargando holders reales desde OpenSea por lote...");
        
        // Petición limpia por slug usando OpenSea V2 para traer los items
        let urlOpenSea = "https://api.opensea.io/api/v2/collection/ograts/nfts?limit=50";
        
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
            throw new Error("OpenSea conectó pero devolvió 0 NFTs para el slug 'ograts'.");
        }

        let snapshotActual = {};

        // Agrupamos el dueño y su cantidad (OpenSea v2 devuelve 'owners' dentro de cada NFT)
        nfts.forEach(nft => {
            // Evaluamos la estructura v2 de dueños por NFT
            if (nft.owners && nft.owners.length > 0) {
                nft.owners.forEach(ownerObj => {
                    const wallet = (ownerObj.address || "").toLowerCase();
                    const cantidad = parseInt(ownerObj.quantity || 1);
                    
                    if (wallet && wallet !== "0x0000000000000000000000000000000000000000") {
                        if (!snapshotActual[wallet]) {
                            snapshotActual[wallet] = { balance: 0, username: null };
                        }
                        snapshotActual[wallet].balance += cantidad;
                    }
                });
            } else if (nft.owner) { // Fallback si viene mapeado en singular
                const wallet = nft.owner.toLowerCase();
                if (wallet !== "0x0000000000000000000000000000000000000000") {
                    if (!snapshotActual[wallet]) snapshotActual[wallet] = { balance: 0, username: null };
                    snapshotActual[wallet].balance += 1;
                }
            }
        });

        // Formateamos las filas para que coincidan al 100% con tu base de datos de Supabase
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

        // Upsert masivo en Supabase para machacar y actualizar balances sin duplicar addresses
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
            message: "¡Sincronización de lote real de OpenSea completada!",
            wallets_procesadas: filasAInsertar.length
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
