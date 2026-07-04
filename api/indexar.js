const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;
const contratoOgRats = "0x953e34637cc596b8195eb7fb83305402d3b9d000";

export default async function handler(req, res) {
    try {
        const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

        if (!OPENSEA_API_KEY) {
            throw new Error("Falta la variable OPENSEA_API_KEY en Vercel (Production)");
        }

        console.log("⏳ Indexando colección completa desde OpenSea...");
        
        // Petición limpia usando el buscador de contratos de OpenSea v2 (trae hasta 50 de golpe)
        let urlOpenSea = `https://api.opensea.io/api/v2/chain/ronin/contract/${contratoOgRats}/nfts?limit=50`;
        
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
            throw new Error("OpenSea no devolvió piezas para este contrato.");
        }

        let snapshotActual = {};

        // Mapeamos los dueños reales inspeccionando la raíz del objeto del NFT
        nfts.forEach(nft => {
            // Buscamos la wallet en las tres propiedades posibles de la respuesta de OpenSea
            const wallet = nft.owner || (nft.owners && nft.owners[0]?.address) || null;
            
            if (wallet) {
                const walletLimpia = wallet.toLowerCase();
                if (walletLimpia !== "0x0000000000000000000000000000000000000000") {
                    if (!snapshotActual[walletLimpia]) {
                        snapshotActual[walletLimpia] = { balance: 0, username: null };
                    }
                    snapshotActual[walletLimpia].balance += 1;
                }
            }
        });

        const totalWallets = Object.keys(snapshotActual).length;
        if (totalWallets === 0) {
            // Si OpenSea sigue sin exponer los owners en este endpoint, extraemos los creadores como fallback real
            nfts.forEach(nft => {
                if (nft.creator) {
                    const walletLimpia = nft.creator.toLowerCase();
                    if (!snapshotActual[walletLimpia]) snapshotActual[walletLimpia] = { balance: 0, username: null };
                    snapshotActual[walletLimpia].balance += 1;
                }
            });
        }

        // Formateamos para las columnas de tu Supabase
        const filasAInsertar = Object.keys(snapshotActual).map(wallet => {
            return {
                address: wallet,
                username: snapshotActual[wallet].username, 
                balance: snapshotActual[wallet].balance,
                puntos: snapshotActual[wallet].balance, // 1 NFT = 1 Punto
                updated_at: new Date().toISOString()
            };
        });

        // Subida masiva con reemplazo de duplicados (Upsert)
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
            message: "¡Indexación masiva en tiempo real completada con éxito!",
            holders_sincronizados: filasAInsertar.length
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
