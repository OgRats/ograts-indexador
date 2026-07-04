const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
    try {
        const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

        // Pedimos los holders ordenados por el que tenga más puntos
        const response = await fetch(`${SUPABASE_URL}/rest/v1/ograts_holders?select=address,puntos&order=puntos.desc&limit=50`, {
            method: "GET",
            headers: {
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
            }
        });

        if (!response.ok) throw new Error("No se pudieron obtener los datos de Supabase");

        const datos = await response.json();
        return res.status(200).json(datos);

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
