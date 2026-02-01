const axios = require('axios');

const getTrafficData = async (originLat, originLng, destLat, destLng) => {
    try {
        const apiKey = process.env.GOOGLE_MAPS_API_KEY;
        if (!apiKey) {
            console.log("⚠️ No Google Maps Key found in .env");
            return null; 
        }

        const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${originLat},${originLng}&destinations=${destLat},${destLng}&departure_time=now&key=${apiKey}`;

        const response = await axios.get(url);
        const data = response.data;

        if (data.status === 'OK' && data.rows[0].elements[0].status === 'OK') {
            const element = data.rows[0].elements[0];
            return {
                distanceKm: element.distance.value / 1000, // meters to km
                durationMins: element.duration_in_traffic 
                    ? (element.duration_in_traffic.value / 60) 
                    : (element.duration.value / 60) // seconds to mins
            };
        }
        return null;
    } catch (error) {
        console.error("Maps Service Error:", error.message);
        return null; 
    }
};

module.exports = { getTrafficData };