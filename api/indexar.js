const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;

export default async function handler(req, res) {
    try {
        const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

        if (!OPENSEA_API_KEY) {
            throw new Error("Falta la variable OPENSEA_API_KEY en Vercel (Production)");
        }

        console.log("⏳ Descargando catálogo real de la colección desde OpenSea...");
        
        // Endpoint oficial por slug para obtener los NFTs activos de ograts
        const urlOpenSea = "https://api.opensea.io/api/v2/collection/ograts/nfts?limit=50";
        
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
            throw new Error("OpenSea no devolvió ningún ítem para el slug 'ograts'.");
        }

        let snapshotActual = {};

        // Escáner profundo de dueños para la API v2 de OpenSea
        nfts.forEach(nft => {
            let walletDetectada = null;
            let usernameDetectado = null;

            // Opción A: Viene dentro de la propiedad estándar 'owner'
            if (nft.owner) {
                walletDetectada = typeof nft.owner === 'string' ? nft.owner : (nft.owner.address || null);
                usernameDetectado = nft.owner.username || null;
            } 
            // Opción B: Viene dentro de un arreglo 'owners' (Formato común en colecciones ERC-1155 o compartidas)
            else if (nft.owners && nft.owners.length > 0) {
                const primerDueno = nft.owners[0];
                walletDetectada = primerDueno.address || null;
                usernameDetectado = primerDueno.username || null;
            }
            // Opción C: Formato anidado de cuentas alternativas de OpenSea
            else if (nft.creator) {
                walletDetectada = nft.creator.address || null;
                usernameDetectado = nft.creator.username || null;
            }

            // Si logramos capturar la wallet por cualquiera de las vías anteriores
            if (walletDetectada) {
                const walletLimpia = walletDetectada.toLowerCase();
                // Ignoramos la dirección de quema nula (billetera muerta)
                if (walletLimpia !== "0x0000000000000000000000000000000000000000") {
                    if (!snapshotActual[walletLimpia]) {
                        snapshotActual[walletLimpia] = {
                            balance: 0,
                            username: usernameDetectado || nft.creator_username || null
                        };
                    }
                    snapshotActual[walletLimpia].balance += 1;
                }
            }
        });

        if (Object.keys(snapshotActual).length === 0) {
            throw new Error("El escáner no pudo mapear los campos de dueño de OpenSea. Formato de respuesta incompatible.");
        }

        // Formateamos las filas para que coincidan exactamente con tu tabla de Supabase
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

        // Guardamos todo de golpe machacando duplicados en Supabase
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
            message: "¡Sincronización real completada con OpenSea!",
            wallets_procesadas: filasAInsertar.length
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
