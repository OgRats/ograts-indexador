const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const contratoOgRats = "0x953e34637cc596b8195eb7fb83305402d3b9d000"; 

export default async function handler(req, res) {
    try {
        const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

        console.log("⏳ Conectando al nodo de Ronin con parámetros estándar...");
        const urlRonin = "https://api.roninchain.com/rpc";

        // Usamos "latest" tanto para el bloque inicial como para el final para evitar el error de rango inválido
        const responseRpc = await fetch(urlRonin, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "eth_getLogs",
                params: [{
                    address: contratoOgRats,
                    fromBlock: "latest", 
                    toBlock: "latest",
                    topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"] // Transfer
                }]
            })
        });

        if (!responseRpc.ok) {
            throw new Error(`El nodo de Ronin no aceptó la conexión. Código: ${responseRpc.status}`);
        }

        const jsonRpc = await responseRpc.json();
        
        if (jsonRpc.error) {
            throw new Error(`Error del nodo Ronin: ${jsonRpc.error.message}`);
        }

        const logs = jsonRpc.result || [];

        // Si en el último bloque no hubo transferencias, procesamos un mapeo base para verificar Supabase
        let snapshotActual = {};

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

        // Para evitar que se quede vacío si no hubo transferencias exactas en el último bloque,
        // nos aseguramos de estructurar una respuesta limpia
        const filasAInsertar = Object.keys(snapshotActual).map(wallet => {
            return {
                address: wallet,
                username: null, 
                balance: snapshotActual[wallet],
                puntos: snapshotActual[wallet],
                updated_at: new Date().toISOString()
            };
        });

        if (filasAInsertar.length > 0) {
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
        }

        return res.status(200).json({
            success: true,
            message: "¡Parámetros aceptados por el nodo con éxito!",
            transferencias_en_bloque: filasAInsertar.length
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
