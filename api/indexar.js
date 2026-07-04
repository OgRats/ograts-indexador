const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const contratoOgRats = "0x953E34637cC596B8195Eb7FB83305402d3B9D000";

export default async function handler(req, res) {
    try {
        const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

        console.log("⏳ Indexando holders reales directamente desde Ronin RPC...");
        const urlRonin = "https://api.roninchain.com/rpc";

        // Vamos a escanear un lote de los primeros 100 NFTs de la colección
        const loteTokens = 100; 
        let llamadasRPC = [];

        for (let i = 1; i <= loteTokens; i++) {
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

        // Enviamos todo en un solo paquete masivo (Batch) para que no tarde nada
        const response = await fetch(urlRonin, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(llamadasRPC)
        });

        if (!response.ok) throw new Error(`Error en el nodo de Ronin: ${response.status}`);
        const respuestas = await response.json();
        
        let snapshotActual = {};

        // Procesamos las respuestas del lote
        respuestas.forEach(res => {
            if (res.result && res.result !== "0x" && res.result.length >= 66) {
                const wallet = "0x" + res.result.slice(26).toLowerCase();
                if (wallet !== "0x0000000000000000000000000000000000000000") {
                    if (!snapshotActual[wallet]) {
                        snapshotActual[wallet] = { balance: 0 };
                    }
                    snapshotActual[wallet].balance += 1;
                }
            }
        });

        if (Object.keys(snapshotActual).length === 0) {
            throw new Error("No se pudieron leer los dueños desde la Blockchain.");
        }

        // Mapeamos los datos para Supabase aplicando tu regla exacta: 1 NFT = 1 Punto
        const filasAInsertar = Object.keys(snapshotActual).map(wallet => {
            const info = snapshotActual[wallet];
            return {
                address: wallet,
                username: null, // La blockchain no da nombres, se mostrará la wallet recortada de forma limpia
                balance: info.balance,
                puntos: info.balance, // 1 NFT = 1 Punto
                updated_at: new Date().toISOString()
            };
        });

        // Guardamos todo de golpe en Supabase
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

        if (!resInsert.ok) throw new Error("Error al escribir los holders en Supabase");

        return res.status(200).json({ 
            success: true, 
            message: `¡Sincronizado! Se cargaron ${filasAInsertar.length} wallets reales con sus balances exactos analizados de la blockchain.` 
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
