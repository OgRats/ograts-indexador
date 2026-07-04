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

        console.log("⏳ Obteniendo todos los NFTs y holders desde OpenSea V2 (Ronin)...");
        
        // Endpoint correcto de OpenSea V2 para listar los NFTs de un contrato en Ronin
        const urlOpenSea = `https://api.opensea.io/api/v2/chain/ronin/contract/${contratoOgRats}/nfts?limit=100`;

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
        const nfts = jsonOS.nfts || [];
        
        let snapshotActual = {};

        // Recorremos los NFTs para agruparlos por dueño y extraer sus nombres de OpenSea
        nfts.forEach(nft => {
            const wallet = (nft.owner || "").toLowerCase();
            
            if (wallet && wallet !== "0x0000000000000000000000000000000000000000") {
                // Intentamos buscar el nombre de usuario dentro de los datos del NFT en OpenSea
                // Nota: OpenSea a veces lo estructura en nft.owners o dentro de los metadatos del creador/dueño
                let username = null;
                if (nft.creator_username) {
                    username = nft.creator_username;
                }

                if (!snapshotActual[wallet]) {
                    snapshotActual[wallet] = {
                        balance: 0,
                        username: username
                    };
                }
                snapshotActual[wallet].balance += 1;
            }
        });

        if (Object.keys(snapshotActual).length === 0) {
            throw new Error("No se encontraron NFTs o dueños activos en la respuesta de OpenSea.");
        }

        // Preparamos las filas para Supabase incluyendo la columna username
        const filasAInsertar = Object.keys(snapshotActual).map(wallet => {
            const info = snapshotActual[wallet];
            return {
                address: wallet,
                username: info.username, // Guardamos el nombre de la cuenta de OpenSea si existe
                balance: info.balance,    // Cuántos NFTs tiene de este lote
                puntos: info.balance,     // REGLA: 1 NFT = 1 Punto
                updated_at: new Date().toISOString()
            };
        });

        // Guardamos en Supabase
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
            const errText = await resInsert.text();
            throw new Error(`Supabase rechazó los datos: ${errText}`);
        }

        return res.status(200).json({ 
            success: true, 
            message: `¡Sincronización real completada! Se procesaron ${filasAInsertar.length} holders reales de OpenSea con sus nombres.` 
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
