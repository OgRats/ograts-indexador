const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;

export default async function handler(req, res) {
    try {
        const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

        if (!OPENSEA_API_KEY) {
            throw new Error("Falta la variable OPENSEA_API_KEY en Vercel (Production)");
        }

        // Endpoint oficial por slug para obtener los NFTs
        const urlOpenSea = "https://api.opensea.io/api/v2/collection/ograts/nfts?limit=5";
        
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

        // Mapeo básico para ver si engancha algo
        let snapshotActual = {};
        nfts.forEach(nft => {
            // Evaluamos la propiedad exacta imprimiendo opciones en crudo
            const wallet = nft.owner || (nft.owners && nft.owners[0]?.address) || null;
            if (wallet) {
                const wLimpia = wallet.toLowerCase();
                snapshotActual[wLimpia] = (snapshotActual[wLimpia] || 0) + 1;
            }
        });

        // SI FALLA EL MAPEO, EN LUGAR DE LANZAR ERROR, TE MUESTRA EL PRIMER NFT EN PANTALLA
        if (Object.keys(snapshotActual).length === 0) {
            return res.status(200).json({
                success: false,
                message: "Estructura no compatible. Aquí tienes el primer NFT para revisar sus campos:",
                estructura_nft_ejemplo: nfts[0] // Esto nos va a decir exactamente dónde viene la wallet
            });
        }

        // Si funciona, guarda en Supabase normalmente
        const filasAInsertar = Object.keys(snapshotActual).map(wallet => {
            return {
                address: wallet,
                username: null, 
                balance: snapshotActual[wallet],
                puntos: snapshotActual[wallet],
                updated_at: new Date().toISOString()
            };
        });

        await fetch(`${SUPABASE_URL}/rest/v1/ograts_holders`, {
            method: "POST",
            headers: {
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates"
            },
            body: JSON.stringify(filasAInsertar)
        });

        return res.status(200).json({ 
            success: true, 
            message: "Sincronizado",
            wallets: filasAInsertar.length
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
