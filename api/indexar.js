const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;

export default async function handler(req, res) {
    try {
        const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

        if (!OPENSEA_API_KEY) {
            throw new Error("Falta la variable OPENSEA_API_KEY en Vercel");
        }

        console.log("⏳ Obteniendo ítems y dueños reales desde OpenSea v2...");
        
        // Reemplaza 'ograts' por el slug exacto de tu colección en OpenSea si es diferente (míralo en la URL de OpenSea)
        const coleccionSlug = "ograts"; 
        const urlOpenSea = `https://api.opensea.io/api/v2/collection/${coleccionSlug}/nfts?limit=50`;

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

        // Recorremos los NFTs devueltos para agruparlos por dueño real
        nfts.forEach(nft => {
            // Obtenemos la wallet del dueño
            const wallet = (nft.owner || "").toLowerCase();
            
            if (wallet && wallet !== "0x0000000000000000000000000000000000000000") {
                if (!snapshotActual[wallet]) {
                    snapshotActual[wallet] = {
                        balance: 0,
                        username: "" // Si la API no da nombres en este nivel, se rellenará con su wallet reducida en la tabla
                    };
                }
                // Sumamos 1 NFT al contador de esta wallet
                snapshotActual[wallet].balance += 1;
            }
        });

        if (Object.keys(snapshotActual).length === 0) {
            throw new Error("No se encontraron NFTs o dueños activos en la respuesta.");
        }

        // 2. Preparar las filas calculando exactamente 1 punto por cada NFT detectado
        const filasAInsertar = Object.keys(snapshotActual).map(wallet => {
            const info = snapshotActual[wallet];
            return {
                address: wallet,
                username: info.username || null, 
                balance: info.balance,    // Cuántos NFTs tiene de los analizados
                puntos: info.balance,     // REGLA: 1 NFT = 1 Punto
                updated_at: new Date().toISOString()
            };
        });

        // 3. Guardar y actualizar de forma limpia en tu Supabase
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

        if (!resInsert.ok) throw new Error("Error escribiendo los datos en Supabase");

        return res.status(200).json({ 
            success: true, 
            message: `¡Sincronización exitosa! Se procesaron ${filasAInsertar.length} wallets reales con sus respectivos balances.` 
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
