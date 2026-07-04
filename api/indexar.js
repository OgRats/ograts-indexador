const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;

export default async function handler(req, res) {
    try {
        const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

        if (!OPENSEA_API_KEY) {
            throw new Error("Falta la variable OPENSEA_API_KEY en Vercel");
        }

        console.log("⏳ Extrayendo holders reales desde OpenSea API...");
        
        // Usamos el endpoint oficial de OpenSea v2 para obtener los dueños de la colección completa por su SLUG
        const urlOpenSea = `https://api.opensea.io/api/v2/collections/ograts/owners?limit=100`;

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

        // OpenSea nos devuelve directamente la wallet y cuántos NFTs tiene de la colección
        owners.forEach(item => {
            const wallet = (item.address || "").toLowerCase();
            const cantidadNfts = parseInt(item.quantity || 0);
            
            if (wallet && wallet !== "0x0000000000000000000000000000000000000000" && cantidadNfts > 0) {
                snapshotActual[wallet] = {
                    balance: cantidadNfts,
                    username: item.username || null // Extrae el nombre de usuario de la cuenta si tiene
                };
            }
        });

        if (Object.keys(snapshotActual).length === 0) {
            throw new Error("La API de OpenSea no devolvió dueños para el slug 'ograts'.");
        }

        // Armamos el paquete para Supabase: 1 NFT = 1 Punto
        const filasAInsertar = Object.keys(snapshotActual).map(wallet => {
            const info = snapshotActual[wallet];
            return {
                address: wallet,
                username: info.username, 
                balance: info.balance,
                puntos: info.balance, // REGLA: 1 NFT = 1 Punto
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
            const txtErr = await resInsert.text();
            throw new Error(`Supabase rechazó la inserción: ${txtErr}`);
        }

        return res.status(200).json({ 
            success: true, 
            message: `¡Sincronización completa! Se cargaron ${filasAInsertar.length} holders reales de la colección con sus balances y nombres.` 
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
