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

        console.log("⏳ Consultando holders reales en OpenSea v2...");
        
        // Petición estándar v2 de OpenSea para traer los NFTs activos de un contrato en Ronin
        const urlOpenSea = `https://api.opensea.io/api/v2/chain/ronin/contract/${contratoOgRats}/nfts?limit=100`;

        const responseOS = await fetch(urlOpenSea, {
            method: "GET",
            headers: { 
                "Accept": "application/json",
                "X-API-KEY": OPENSEA_API_KEY
            }
        });

        if (!responseOS.ok) {
            throw new Error(`OpenSea respondió con código: ${responseOS.status}`);
        }

        const jsonOS = await responseOS.json();
        const nfts = jsonOS.nfts || [];
        
        let snapshotActual = {};

        // Agrupamos los NFTs por billetera y guardamos el username si existe
        nfts.forEach(nft => {
            const wallet = (nft.owner || "").toLowerCase();
            
            if (wallet && wallet !== "0x0000000000000000000000000000000000000000") {
                // Buscamos el nombre de usuario de OpenSea si viene disponible
                let username = null;
                if (nft.creator_username) username = nft.creator_username;

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
            throw new Error("No se encontraron piezas o dueños en la respuesta.");
        }

        // Mapeamos los datos limpios para Supabase
        const filasAInsertar = Object.keys(snapshotActual).map(wallet => {
            const info = snapshotActual[wallet];
            return {
                address: wallet,
                username: info.username, 
                balance: info.balance,
                puntos: info.balance, // Regla fija: 1 NFT = 1 Punto
                updated_at: new Date().toISOString()
            };
        });

        // Guardamos todo en la base de datos reemplazando duplicados
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
            const errTxt = await resInsert.text();
            throw new Error(`Supabase rechazó la inserción: ${errTxt}`);
        }

        return res.status(200).json({ 
            success: true, 
            message: `¡Sincronización real completada con OpenSea!`,
            total_holders: filasAInsertar.length
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
