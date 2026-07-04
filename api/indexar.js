const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const contratoOgRats = "0x953e34637cc596b8195eb7fb83305402d3b9d000"; 

export default async function handler(req, res) {
    try {
        const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

        console.log("⏳ Conectando al nodo nativo de Ronin Chain...");
        
        // Usamos el endpoint RPC oficial y estable de la red Ronin
        const urlRonin = "https://api.roninchain.com/rpc";

        // Consultamos los Logs usando un rango de bloques seguro en formato hexadecimal estándar
        const responseRpc = await fetch(urlRonin, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "eth_getLogs",
                params: [{
                    address: contratoOgRats,
                    fromBlock: "0x1B00000", // Rango amplio pero seguro para evitar saturar el nodo público
                    toBlock: "latest",
                    topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"] // Evento Transfer(address,address,uint256)
                }]
            })
        });

        if (!responseRpc.ok) {
            throw new Error(`El nodo de Ronin no responde. Código: ${responseRpc.status}`);
        }

        const jsonRpc = await responseRpc.json();
        
        if (jsonRpc.error) {
            throw new Error(`Error devuelto por el nodo: ${jsonRpc.error.message}`);
        }

        const logs = jsonRpc.result || [];

        if (logs.length === 0) {
            throw new Error("No se detectaron transferencias en la blockchain para este contrato en el rango de bloques.");
        }

        let snapshotActual = {};

        // Procesamos el historial real de la red para calcular los balances netos exactos
        logs.forEach(log => {
            if (log.topics.length >= 4) {
                // Limpiamos los paddings de ceros para extraer las wallets reales
                const de = "0x" + log.topics[1].slice(26).toLowerCase();
                const para = "0x" + log.topics[2].slice(26).toLowerCase();

                // Sumamos 1 NFT al que recibe la transferencia
                if (para !== "0x0000000000000000000000000000000000000000") {
                    snapshotActual[para] = (snapshotActual[para] || 0) + 1;
                }
                // Restamos 1 NFT al que envía o transfiere la pieza
                if (de !== "0x0000000000000000000000000000000000000000" && snapshotActual[de]) {
                    snapshotActual[de] = Math.max(0, snapshotActual[de] - 1);
                    if (snapshotActual[de] === 0) delete snapshotActual[de];
                }
            }
        });

        // Formateamos la lista de holders para tu tabla de Supabase
        const filasAInsertar = Object.keys(snapshotActual).map(wallet => {
            return {
                address: wallet,
                username: null, // El frontend se encargará de renderizar la wallet de forma estética
                balance: snapshotActual[wallet],
                puntos: snapshotActual[wallet], // 1 NFT = 1 Punto
                updated_at: new Date().toISOString()
            };
        });

        if (filasAInsertar.length === 0) {
            throw new Error("El procesamiento de balances netos resultó en 0 holders activos.");
        }

        // Subida masiva limpia con resolución de duplicados en Supabase
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
            throw new Error(`Supabase rechazó la inserción masiva: ${txtErr}`);
        }

        return res.status(200).json({
            success: true,
            message: "¡Rehecho con éxito! Sincronización limpia completada desde la blockchain de Ronin.",
            total_holders_reales: filasAInsertar.length
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
