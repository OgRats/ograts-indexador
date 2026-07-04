const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const contratoOgRats = "0x953E34637cC596B8195Eb7FB83305402d3B9D000";

export default async function handler(req, res) {
    const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
    let snapshotActual = {};

    try {
        console.log("⏳ Conectando directamente al nodo RPC de Ronin...");
        const urlRonin = "https://api.roninchain.com/rpc";
        
        // Pedimos logs en un rango intermedio para no saturar el nodo público
        const responseRpc = await fetch(urlRonin, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0", id: 1, method: "eth_getLogs",
                params: [{
                    address: contratoOgRats,
                    fromBlock: "0x1cb4c00", // Bloque estimado para optimizar la búsqueda
                    toBlock: "latest",
                    topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"] // Transferencias
                }]
            })
        });

        if (!responseRpc.ok) throw new Error(`Nodo Ronin caído o saturado: ${responseRpc.status}`);
        
        const jsonRpc = await responseRpc.json();
        const logs = jsonRpc.result || [];
        
        if (logs.length === 0) {
            throw new Error("El nodo respondió, pero no encontró transferencias en este rango de bloques.");
        }

        // Procesamos transferencias reales
        logs.forEach(log => {
            if (log.topics.length >= 4) {
                const de = "0x" + log.topics[1].slice(26).toLowerCase();
                const para = "0x" + log.topics[2].slice(26).toLowerCase();
                
                if (para !== "0x0000000000000000000000000000000000000000") {
                    if (!snapshotActual[para]) snapshotActual[para] = { balance: 0 };
                    snapshotActual[para].balance += 1;
                }
                if (de !== "0x0000000000000000000000000000000000000000" && snapshotActual[de]) {
                    snapshotActual[de].balance = Math.max(0, snapshotActual[de].balance - 1);
                    if (snapshotActual[de].balance === 0) delete snapshotActual[de];
                }
            }
        });

        // Formateamos para Supabase (Sin trucos, directo lo que de la blockchain)
        const filasAInsertar = Object.keys(snapshotActual).map(wallet => {
            return {
                address: wallet,
                username: null,
                balance: snapshotActual[wallet].balance,
                puntos: snapshotActual[wallet].balance, // 1 NFT = 1 Punto
                updated_at: new Date().toISOString()
            };
        });

        if (filasAInsertar.length === 0) throw new Error("No hay holders reales calculados en este lote.");

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

        if (!resInsert.ok) throw new Error("Supabase rechazó la inserción.");

        return res.status(200).json({
            success: true,
            message: `¡Datos reales sincronizados directamente desde la Blockchain!`,
            holders_actualizados: filasAInsertar.length
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
