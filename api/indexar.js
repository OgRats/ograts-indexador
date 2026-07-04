const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const contratoOgRats = "0x953E34637cC596B8195Eb7FB83305402d3B9D000";

export default async function handler(req, res) {
    try {
        const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

        console.log("⏳ Escaneando la blockchain de Ronin de inicio a fin...");
        const urlRonin = "https://api.roninchain.com/rpc";

        // Consultamos los Logs nativos de transferencia desde el bloque 0 sin restricciones de rango
        const responseRpc = await fetch(urlRonin, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "eth_getLogs",
                params: [{
                    address: contratoOgRats,
                    fromBlock: "0x0", // Desde el bloque génesis de Ronin
                    toBlock: "latest", // Hasta el bloque de este segundo
                    topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"] // Evento Transfer estándar (ERC-721)
                }]
            })
        });

        if (!responseRpc.ok) {
            throw new Error(`El nodo de Ronin rechazó la conexión directa. Código: ${responseRpc.status}`);
        }

        const jsonRpc = await responseRpc.json();
        const logs = jsonRpc.result || [];

        if (logs.length === 0) {
            throw new Error("La blockchain no tiene registros de transferencias para este contrato. Verifica que el address del contrato sea el correcto.");
        }

        let snapshotActual = {};

        // Reconstruimos el mapa exacto de holders procesando el historial
        logs.forEach(log => {
            if (log.topics.length >= 4) {
                const de = "0x" + log.topics[1].slice(26).toLowerCase();
                const para = "0x" + log.topics[2].slice(26).toLowerCase();

                // Sumamos al que recibe
                if (para !== "0x0000000000000000000000000000000000000000") {
                    snapshotActual[para] = (snapshotActual[para] || 0) + 1;
                }
                // Restamos al que envía
                if (de !== "0x0000000000000000000000000000000000000000" && snapshotActual[de]) {
                    snapshotActual[de] = Math.max(0, snapshotActual[de] - 1);
                    if (snapshotActual[de] === 0) delete snapshotActual[de];
                }
            }
        });

        // Formateamos las filas mapeando de forma limpia para tu tabla de Supabase
        const filasAInsertar = Object.keys(snapshotActual).map(wallet => {
            return {
                address: wallet,
                username: null, 
                balance: snapshotActual[wallet],
                puntos: snapshotActual[wallet], // 1 NFT = 1 Punto
                updated_at: new Date().toISOString()
            };
        });

        if (filasAInsertar.length === 0) {
            throw new Error("No se pudieron generar holders netos con balances mayores a 0.");
        }

        // Enviamos todo a Supabase
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
            message: "¡Balances reales calculados directamente desde el contrato en Ronin!",
            total_holders: filasAInsertar.length
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
