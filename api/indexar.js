const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const contratoOgRats = "0x953E34637cC596B8195Eb7FB83305402d3B9D000";

export default async function handler(req, res) {
    try {
        const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

        // Leemos desde qué NFT empezar usando un parámetro en la URL (?desde=1)
        // Si no se pone nada, por defecto empieza desde el NFT #1
        const desde = parseInt(req.query.desde) || 1;
        const loteSize = 200; // Procesamos 200 tokens por tanda para no saturar
        const hasta = desde + loteSize - 1;

        console.log(`⏳ Escaneando tokens desde el #${desde} hasta el #${hasta} directamente en Ronin...`);
        const urlRonin = "https://api.roninchain.com/rpc";

        let llamadasRPC = [];
        for (let i = desde; i <= hasta; i++) {
            const tokenIdHex = i.toString(16).padStart(64, '0');
            llamadasRPC.push({
                jsonrpc: "2.0",
                id: i,
                method: "eth_call",
                params: [{
                    to: contratoOgRats,
                    data: "0x6352211e" + tokenIdHex // Función ownerOf(uint256)
                }, "latest"]
            });
        }

        // Hacemos la petición masiva en bloques de 50 para evitar el error 400 del nodo
        let snapshotActual = {};
        const tamañoSubLote = 50;

        for (let j = 0; j < llamadasRPC.length; j += tamañoSubLote) {
            const subLote = llamadasRPC.slice(j, j + tamañoSubLote);
            const response = await fetch(urlRonin, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(subLote)
            });

            if (response.ok) {
                const respuestas = await response.json();
                if (Array.isArray(respuestas)) {
                    respuestas.forEach(resRpc => {
                        if (resRpc.result && resRpc.result !== "0x" && resRpc.result.length >= 66) {
                            const wallet = "0x" + resRpc.result.slice(26).toLowerCase();
                            if (wallet !== "0x0000000000000000000000000000000000000000") {
                                snapshotActual[wallet] = (snapshotActual[wallet] || 0) + 1;
                            }
                        }
                    });
                }
            }
        }

        const totalWalletsEncontradas = Object.keys(snapshotActual).length;
        if (totalWalletsEncontradas === 0) {
            throw new Error("El nodo no devolvió ningún dueño para este rango de tokens.");
        }

        // Consultamos qué datos ya teníamos en Supabase para no borrar los puntos acumulados
        const resPrevia = await fetch(`${SUPABASE_URL}/rest/v1/ograts_holders?select=address,puntos,balance`, {
            method: "GET",
            headers: { "apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }
        });
        const datosViejos = resPrevia.ok ? await resPrevia.json() : [];
        
        let baseDeDatosMapeada = {};
        datosViejos.forEach(row => {
            if (row.address) baseDeDatosMapeada[row.address.toLowerCase()] = row;
        });

        // Preparamos las filas unificando los balances reales actuales (1 NFT = 1 Punto)
        const filasAInsertar = Object.keys(snapshotActual).map(wallet => {
            const nftsDetectadosEnEsteLote = snapshotActual[wallet];
            const registroPrevio = baseDeDatosMapeada[wallet] || { puntos: 0, balance: 0 };

            // El balance nuevo será lo previo más lo que encontramos en este lote
            const balanceFinal = registroPrevio.balance + nftsDetectadosEnEsteLote;

            return {
                address: wallet,
                username: null, // Dejamos que el frontend pinte la wallet de forma limpia y pro
                balance: balanceFinal,
                puntos: balanceFinal, // REGLA: 1 NFT = 1 Punto real de balance
                updated_at: new Date().toISOString()
            };
        });

        // Guardamos todo de golpe usando un Upsert (merge) en Supabase
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
            message: `¡Lote indexado con éxito! Analizados tokens del ${desde} al ${hasta}. Siguiente lote: ?desde=${hasta + 1}` 
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
