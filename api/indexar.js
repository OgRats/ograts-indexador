const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const contratoOgRats = "0x953E34637cC596B8195Eb7FB83305402d3B9D000";

export default async function handler(req, res) {
    try {
        const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

        console.log("⏳ Obteniendo holders desde el nodo público de Ronin...");
        const urlRonin = "https://api.roninchain.com/rpc";

        // Consultamos los eventos de transferencia (Transfer) del contrato para armar la lista de dueños
        const response = await fetch(urlRonin, {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "eth_getLogs",
                params: [{
                    address: contratoOgRats,
                    fromBlock: "0x0",
                    toBlock: "latest",
                    // Tópico estándar para el evento Transfer(address,address,uint256)
                    topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"]
                }]
            })
        });

        if (!response.ok) throw new Error(`Ronin respondió con código ${response.status}`);
        const json = await response.json();
        if (json.error) throw new Error(`Error RPC: ${json.error.message}`);

        const logs = json.result || [];
        let snapshotActual = {};

        // Procesamos los logs para saber quién tiene qué NFT actualmente
        logs.forEach(log => {
            if (log.topics.length >= 4) {
                const de = "0x" + log.topics[1].slice(26).toLowerCase();
                const para = "0x" + log.topics[2].slice(26).toLowerCase();
                
                if (para !== "0x0000000000000000000000000000000000000000") {
                    snapshotActual[para] = (snapshotActual[para] || 0) + 1;
                }
                if (de !== "0x0000000000000000000000000000000000000000" && snapshotActual[de]) {
                    snapshotActual[de] = Math.max(0, snapshotActual[de] - 1);
                    if (snapshotActual[de] === 0) delete snapshotActual[de];
                }
            }
        });

        if (Object.keys(snapshotActual).length === 0) {
            throw new Error("No se encontraron dueños activos.");
        }

        // 2. Consultar historial en Supabase
        const resPrevia = await fetch(`${SUPABASE_URL}/rest/v1/ograts_holders?select=address,puntos`, {
            method: "GET",
            headers: { "apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }
        });

        const datosViejos = resPrevia.ok ? await resPrevia.json() : [];
        const historialPuntos = {};
        datosViejos.forEach(row => {
            if (row.address) historialPuntos[row.address.toLowerCase()] = row.puntos || 0;
        });

        // 3. Preparar las filas
        const filasAInsertar = Object.keys(snapshotActual).map(wallet => {
            const nftsHoy = snapshotActual[wallet];
            const puntosViejos = historialPuntos[wallet] || 0;
            return {
                address: wallet,
                balance: nftsHoy,
                puntos: puntosViejos + nftsHoy, // Suma puntos acumulados
                updated_at: new Date().toISOString()
            };
        });

        // 4. Guardar en Supabase
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

        if (!resInsert.ok) throw new Error("Error escribiendo datos en Supabase");

        return res.status(200).json({ 
            success: true, 
            message: `¡Completado! Se encontraron y procesaron ${filasAInsertar.length} dueños únicos.` 
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
