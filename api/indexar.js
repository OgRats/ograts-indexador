const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const contratoOgRats = "0x953E34637cC596B8195Eb7FB83305402d3B9D000";

export default async function handler(req, res) {
    try {
        const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

        console.log("⏳ Conectando directamente a la Blockchain de Ronin...");
        const urlRonin = "https://api.roninchain.com/rpc";

        // Consultamos los Logs de transferencia (Transfer) desde un bloque seguro en la historia de Ronin
        const responseRpc = await fetch(urlRonin, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "eth_getLogs",
                params: [{
                    address: contratoOgRats,
                    fromBlock: "0x1B20000", // Bloque aproximado de lanzamiento para optimizar la velocidad del nodo
                    toBlock: "latest",
                    topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"] // Evento Transfer(address,address,uint256)
                }]
            })
        });

        if (!responseRpc.ok) {
            throw new Error(`El nodo de Ronin no responde (Código ${responseRpc.status}). Inténtalo de nuevo en unos segundos.`);
        }

        const jsonRpc = await responseRpc.json();
        const logs = jsonRpc.result || [];

        if (logs.length === 0) {
            throw new Error("El nodo respondió bien, pero no se detectaron movimientos en este rango de bloques.");
        }

        let snapshotActual = {};

        // Procesamos el historial de transferencias para calcular los balances reales exactos
        logs.forEach(log => {
            if (log.topics.length >= 4) {
                // Limpiamos los ceros de las direcciones hexadecimales para obtener las wallets reales
                const de = "0x" + log.topics[1].slice(26).toLowerCase();
                const para = "0x" + log.topics[2].slice(26).toLowerCase();

                // Si alguien recibe el NFT, se le suma 1 a su balance
                if (para !== "0x0000000000000000000000000000000000000000") {
                    if (!snapshotActual[para]) snapshotActual[para] = 0;
                    snapshotActual[para] += 1;
                }
                // Si alguien envía el NFT, se le resta 1 de su balance
                if (de !== "0x0000000000000000000000000000000000000000" && snapshotActual[de]) {
                    snapshotActual[de] = Math.max(0, snapshotActual[de] - 1);
                    if (snapshotActual[de] === 0) delete snapshotActual[de];
                }
            }
        });

        // Formateamos las filas mapeando address, balance y puntos (1 NFT = 1 Punto)
        const filasAInsertar = Object.keys(snapshotActual).map(wallet => {
            const balanceNfts = snapshotActual[wallet];
            return {
                address: wallet,
                username: null, // Las wallets se formatearán de forma elegante en tu frontend
                balance: balanceNfts,
                puntos: balanceNfts,
                updated_at: new Date().toISOString()
            };
        });

        if (filasAInsertar.length === 0) {
            throw new Error("No se generaron registros de holders activos.");
        }

        // Subimos toda la lista real procesada a Supabase
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
            message: "¡Sincronización real completada directamente desde la Blockchain de Ronin!",
            holders_totales: filasAInsertar.length
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
