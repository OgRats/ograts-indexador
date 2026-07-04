const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const contratoOgRats = "0x953E34637cC596B8195Eb7FB83305402d3B9D000";

export default async function handler(req, res) {
    try {
        const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

        console.log("⏳ Conectando con el nodo público oficial de Ronin...");
        
        // Usamos el nodo público recomendado por la documentación de Ronin
        const urlRonin = "https://ronin.lgns.net/rpc";

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
                        data: "0x70a0823100000000000000000000000000000000000000000000000000000000" 
                    },
                    "latest"
                ]
            })
        });

        if (!response.ok) {
            throw new Error(`Ronin Network respondió con código ${response.status}`);
        }

        const json = await response.json();
        
        // Si el nodo responde con un error interno de RPC
        if (json.error) {
            throw new Error(`Error RPC: ${json.error.message}`);
        }

        // Procesamos la respuesta hexadecimal del nodo rpc
        const resultadoHex = json.result;
        if (!resultadoHex || resultadoHex === "0x") {
            throw new Error("No se recibieron datos del contrato.");
        }

        // 2. Consultar historial en Supabase para validar conexión
        const resPrevia = await fetch(`${SUPABASE_URL}/rest/v1/ograts_holders?select=address,puntos`, {
            method: "GET",
            headers: { "apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }
        });

        if (!resPrevia.ok) {
            throw new Error(`Error al conectar con tu Supabase: Código ${resPrevia.status}`);
        }

        return res.status(200).json({ 
            success: true, 
            message: "¡Conexión exitosa! El script conectó con Ronin y con Supabase correctamente." 
        });

    } catch (error) {
        console.error("❌ Error:", error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
}
