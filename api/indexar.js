const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const contratoOgRats = "0x953E34637cC596B8195Eb7FB83305402d3B9D000";

export default async function handler(req, res) {
    try {
        const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

        console.log("⏳ Iniciando indexación real de holders de OgRats...");
        const urlRonin = "https://api.roninchain.com/rpc";

        // 1. Obtenemos el suministro total para saber cuántos IDs de NFT recorrer
        const responseSupply = await fetch(urlRonin, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0", id: 1, method: "eth_call",
                params: [{ to: contratoOgRats, data: "0x18160ddd" }, "latest"]
            })
        });
        const jsonSupply = await responseSupply.json();
        const totalSupply = parseInt(jsonSupply.result, 16) || 2222;

        // 2. Mapeamos los dueños de los primeros 150 tokens como muestra inicial 
        // (Evita que Vercel se apague por límite de tiempo de 10 segundos en cuentas gratis)
        let snapshotActual = {};
        const limiteTokens = Math.min(totalSupply, 150); 

        for (let i = 1; i <= limiteTokens; i++) {
            const tokenIdHex = i.toString(16).padStart(64, '0');
            const dataOwnerOf = "0x6352211e" + tokenIdHex; // Función ownerOf(uint256)

            const resOwner = await fetch(urlRonin, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jsonrpc: "2.0", id: i, method: "eth_call",
                    params: [{ to: contratoOgRats, data: dataOwnerOf }, "latest"]
                })
            });

            const jsonOwner = await resOwner.json();
            if (jsonOwner.result && jsonOwner.result !== "0x") {
                // Limpiamos la dirección hexadecimal devuelta para dejar solo la wallet
                const wallet = "0x" + jsonOwner.result.slice(26).toLowerCase();
                if (wallet !== "0x0000000000000000000000000000000000000000") {
                    snapshotActual[wallet] = (snapshotActual[wallet] || 0) + 1;
                }
            }
        }

        // 3. Preparar filas asignando 1 punto por cada NFT holdeado
        const filasAInsertar = Object.keys(snapshotActual).map(wallet => {
            const cantidadNfts = snapshotActual[wallet];
            return {
                address: wallet,
                balance: cantidadNfts,
                puntos: cantidadNfts, // 1 NFT = 1 Punto
                updated_at: new Date().toISOString()
            };
        });

        if (filasAInsertar.length === 0) throw new Error("No se detectaron holders.");

        // 4. Guardar o actualizar en Supabase
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

        if (!resInsert.ok) throw new Error("Error guardando holders en Supabase");

        return res.status(200).json({ 
            success: true, 
            message: `¡Leaderboard real actualizado! Se procesaron ${filasAInsertar.length} holders con sus respectivos puntos.` 
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
