const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;
const contratoOgRats = "0x953E34637cC596B8195Eb7FB83305402d3B9D000";

export default async function handler(req, res) {
    try {
        const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

        if (!OPENSEA_API_KEY) {
            throw new Error("Falta la variable OPENSEA_API_KEY en Vercel (Production)");
        }

        console.log("⏳ Descargando historial de eventos desde OpenSea...");
        
        // Buscamos los eventos de transferencia (transfer) del contrato en Ronin
        const urlOpenSea = `https://api.opensea.io/api/v2/events/chain/ronin/contract/${contratoOgRats}?event_type=transfer&limit=50`;
        
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
        const asset_events = jsonOS.asset_events || [];
        
        if (asset_events.length === 0) {
            throw new Error("OpenSea no registró eventos de transferencia recientes para este contrato.");
        }

        let snapshotActual = {};

        // Procesamos los eventos reales
        asset_events.forEach(event => {
            const para = (event.to_address || "").toLowerCase();
            const de = (event.from_address || "").toLowerCase();

            if (para && para !== "0x0000000000000000000000000000000000000000") {
                if (!snapshotActual[para]) snapshotActual[para] = { balance: 0, username: null };
                snapshotActual[para].balance += 1;
            }
            if (de && de !== "0x0000000000000000000000000000000000000000" && snapshotActual[de]) {
                snapshotActual[de].balance = Math.max(0, snapshotActual[de].balance - 1);
                if (snapshotActual[de].balance === 0) delete snapshotActual[de];
            }
        });

        if (Object.keys(snapshotActual).length === 0) {
            throw new Error("No se pudieron extraer balances del historial de eventos.");
        }

        // Mapeamos para Supabase
        const filasAInsertar = Object.keys(snapshotActual).map(wallet => {
            return {
                address: wallet,
                username: null, 
                balance: snapshotActual[wallet].balance,
                puntos: snapshotActual[wallet].balance,
                updated_at: new Date().toISOString()
            };
        });

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
            message: "¡Sincronización mediante historial de eventos completada con éxito!",
            holders_actualizados: filasAInsertar.length
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
