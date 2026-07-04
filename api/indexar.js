const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;

export default async function handler(req, res) {
    try {
        const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

        if (!OPENSEA_API_KEY) {
            throw new Error("Falta la variable OPENSEA_API_KEY en Vercel (Production)");
        }

        console.log("⏳ Consultando el listado directo de dueños de la colección en OpenSea...");
        
        // Endpoint v2 oficial de OpenSea exclusivo para listar los dueños (owners) de una colección
        const urlOpenSea = "https://api.opensea.io/api/v2/collections/ograts/owners?limit=150";
        
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
        
        // La API v2 para este endpoint devuelve la lista dentro de jsonOS.owners
        const ownersList = jsonOS.owners || [];
        
        if (ownersList.length === 0) {
            throw new Error("OpenSea respondió 200, pero la lista 'owners' vino vacía. Comprueba el slug de la colección.");
        }

        let snapshotActual = {};

        // Recorremos la lista estructurada de dueños que devuelve OpenSea
        ownersList.forEach(ownerData => {
            // En este endpoint, la wallet viene directo en ownerData.owner o ownerData.address
            const wallet = (ownerData.owner || ownerData.address || "").toLowerCase();
            const cantidad = parseInt(ownerData.quantity || 0);
            
            if (wallet && wallet !== "0x0000000000000000000000000000000000000000" && cantidad > 0) {
                // OpenSea asocia el nombre de usuario de la cuenta si existe
                const username = ownerData.username || null;

                if (!snapshotActual[wallet]) {
                    snapshotActual[wallet] = {
                        balance: 0,
                        username: username
                    };
                }
                snapshotActual[wallet].balance += cantidad;
            }
        });

        if (Object.keys(snapshotActual).length === 0) {
            throw new Error("No se pudieron mapear los campos 'owner' o 'quantity' de la respuesta.");
        }

        // Formateamos las filas idénticas para Supabase
        const filasAInsertar = Object.keys(snapshotActual).map(wallet => {
            const info = snapshotActual[wallet];
            return {
                address: wallet,
                username: info.username, 
                balance: info.balance,
                puntos: info.balance, // Regla de oro: 1 NFT = 1 Punto
                updated_at: new Date().toISOString()
            };
        });

        // Insertamos o actualizamos de golpe en Supabase
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
            message: "¡Sincronización real de holders completada!",
            holders_actualizados: filasAInsertar.length
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
