const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const contratoOgRats = "0x953E34637cC596B8195Eb7FB83305402d3B9D000";

export default async function handler(req, res) {
    try {
        const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

        console.log("⏳ Conectando con el nodo oficial...");
        const urlRonin = "https://api.roninchain.com/rpc";

        // Consultamos el suministro total usando la función estándar totalSupply()
        const response = await fetch(urlRonin, {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "eth_call",
                params: [
                    {
                        to: contratoOgRats,
                        data: "0x18160ddd" // Selector hexadecimal para totalSupply()
                    },
                    "latest"
                ]
            })
        });

        if (!response.ok) throw new Error(`Error en nodo Ronin: ${response.status}`);
        const json = await response.json();
        if (json.error) throw new Error(`Error RPC: ${json.error.message}`);

        // Simulamos un holder principal con el suministro para llenar la base de datos de prueba
        // (Esto es para verificar que tu frontend pinte la tabla correctamente)
        const snapshotActual = {
            "0x953e34637cc596b8195eb7fb83305402d3b9d000": 2222
        };

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

        // 3. Preparar filas
        const filasAInsertar = Object.keys(snapshotActual).map(wallet => {
            const nftsHoy = snapshotActual[wallet];
            const puntosViejos = historialPuntos[wallet] || 0;
            return {
                address: wallet,
                balance: nftsHoy,
                puntos: puntosViejos + 10, // Sumamos 10 puntos fijos para la prueba
                updated_at: new Date().toISOString()
            };
        });

        // 4. Guardar los datos en Supabase
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
            message: "¡Completado con éxito! Datos insertados correctamente en Supabase." 
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
