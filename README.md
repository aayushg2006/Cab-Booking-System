# Cab Booking System (Master README)

A full-stack, real-time cab booking platform with:
- Mobile app (React Native + Expo)
- Backend API and WebSocket server (Node.js + Express + Socket.IO)
- MySQL database (cloud or local)

This repository supports rider and driver workflows end-to-end, including live driver tracking, OTP ride start, in-ride chat, cancellation reasons, SOS, payments, ratings, promo codes, scheduled rides, and saved places.

## 1. Core Features

### Rider Features
- User registration and login (JWT auth)
- Fare estimate before booking
- Car category selection (`hatchback`, `sedan`, `suv`)
- Promo code application (`/bookings/apply-promo`)
- Scheduled rides (now / delayed pickup)
- Saved places (Home/Work/custom labels)
- Real-time driver tracking on map
- Ride sharing link (tokenized public tracking URL)
- In-ride chat with driver
- OTP-based secure ride start
- Ride cancellation with reason
- SOS alert endpoint
- Post-ride rating and review
- Payment completion flow (cash/online)
- Ride history, upcoming rides, receipt API

### Driver Features
- Driver registration with vehicle details
- Online/offline availability controls
- Real-time location updates (foreground + background support in app)
- Smart ride request dispatch and fallback to next driver
- Accept/start/end ride lifecycle
- In-ride chat with rider
- Cancellation with reason
- Earnings summary API

### Platform Features
- Runtime reconciliation for stale rides on server startup
- Scheduled ride dispatch queue polling
- Auto schema migration via `ensureSchema()`
- Promo table + redemption tracking
- Cloud MySQL compatible schema/scripts

## 2. Tech Stack

### Frontend
- React Native (Expo SDK 54)
- React Navigation
- react-native-maps + Google Places + Directions
- Socket.IO Client
- Axios

### Backend
- Node.js + Express
- Socket.IO
- mysql2
- JWT + bcryptjs
- Razorpay integration endpoints
- Google Distance Matrix integration for traffic-aware estimates

## 3. Repository Structure

```text
Cab-Booking-System/
  backend/
    controllers/
    routes/
    middleware/
    config/
    utils/
    server.js
    setup_db.js
    rebuild_db.js
    seed_db.js
  frontend/
    src/
      screens/
      components/
      context/
      api/
      utils/
    App.js
```

## 4. Prerequisites

- Node.js 18+
- npm
- MySQL database (local or cloud)
- Google Maps API key (for route/traffic)
- Razorpay keys (optional for online payments)
- Expo Go or emulator/simulator for mobile testing

## 5. Backend Setup

From repo root:

```bash
cd backend
npm install
```

Create `backend/.env`:

```env
PORT=4000

DB_HOST=your_db_host
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=your_db_name
DB_PORT=3306

JWT_SECRET=your_jwt_secret

GOOGLE_MAPS_API_KEY=your_google_maps_api_key

RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret

# Optional
TRIP_SHARE_BASE_URL=http://localhost:4000
SERVER_PUBLIC_URL=http://localhost:4000
TRIP_SHARE_TTL=6h
TRIP_SHARE_SECRET=your_trip_share_secret
SCHEDULED_QUEUE_POLL_MS=30000
```

Initialize schema:

```bash
node setup_db.js
```

Reset database completely (drops and recreates all active tables):

```bash
node rebuild_db.js
```

Optional seed data:

```bash
node seed_db.js
```

Start backend:

```bash
npm start
```

## 6. Frontend Setup

From repo root:

```bash
cd frontend
npm install
```

Create `frontend/.env`:

```env
EXPO_PUBLIC_SERVER_URL=http://your-backend-ip:4000
EXPO_PUBLIC_GOOGLE_API_KEY=your_google_maps_api_key
```

Start app:

```bash
npx expo start
```

## 7. API Overview

Base URL: `http://<backend-host>:<port>/api`

### Auth
- `POST /auth/register`
- `POST /auth/login`

### Bookings
- `POST /bookings/estimate`
- `POST /bookings/apply-promo`
- `POST /bookings/request`
- `POST /bookings/accept`
- `POST /bookings/start`
- `POST /bookings/end`
- `POST /bookings/cancel`
- `POST /bookings/pay`
- `POST /bookings/sos`
- `POST /bookings/rate`
- `GET /bookings/history`
- `GET /bookings/upcoming`
- `GET /bookings/receipt/:bookingId`
- `POST /bookings/share-link`
- `GET /bookings/track/:token` (public)
- `GET /bookings/saved-places`
- `POST /bookings/saved-places`
- `DELETE /bookings/saved-places/:placeId`
- `POST /bookings/driver/availability`
- `POST /bookings/driver-location`
- `GET /bookings/driver/earnings`

### Payments
- `POST /payments/create-order`
- `POST /payments/verify`

## 8. WebSocket Events

### Client -> Server
- `joinRider`
- `joinDriver`
- `driverLocation`
- `declineRide`
- `rideChatMessage`

### Server -> Client
- `newRideRequest`
- `rideAccepted`
- `rideStarted`
- `rideCompleted`
- `driverMoved`
- `rideUnavailable`
- `scheduledRideDelayed`
- `requestTimeout`
- `rideCancelled`
- `rideChatMessage`
- `rideChatAck`

## 9. Active Database Tables

- `users`
- `drivers`
- `bookings`
- `saved_places`
- `promotions`
- `promotion_redemptions`

## 10. Useful Commands

From `backend/`:

```bash
npm start          # start API + socket server
npm run dev        # start with nodemon
node setup_db.js   # create/validate schema
node rebuild_db.js # full reset
node seed_db.js    # insert test rider/driver
```

From `frontend/`:

```bash
npm start
npm run android
npm run ios
npm run web
npm run lint
```

## 11. Troubleshooting

### Port already in use (`EADDRINUSE`)

```powershell
Get-NetTCPConnection -LocalPort 4000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

### App cannot reach backend from phone
- Use your machine LAN IP in `EXPO_PUBLIC_SERVER_URL`
- Ensure backend is listening on that port
- Ensure firewall allows inbound traffic

### Pricing/ETA fallback behavior
- If Google Maps API key is missing/invalid, backend falls back to Haversine distance logic

## 12. Security Notes

- Do not commit `.env` files with real secrets
- Rotate JWT, DB, Razorpay, and Google keys if exposed
- Use production CORS and auth hardening before deployment

## 13. License

MIT 