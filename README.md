# 🚖 Real-Time Cab Booking System

A highly scalable, full-stack real-time ride-hailing application built with **React Native (Expo)**, **Node.js**, **MySQL**, and **Redis**. 

This system provides a seamless experience for both riders and drivers, featuring live location tracking, an intelligent nearest-driver matching algorithm, dynamic surge pricing, and a highly resilient WebSocket architecture for real-time communication.

---

## ✨ Key Features

### 👤 For Riders
* **Smart Routing & Fare Estimation:** Calculates distance, duration, and dynamically applies surge pricing based on real-time traffic and demand.
* **Live Driver Tracking:** Watch your assigned driver approach in real-time on the interactive map.
* **Secure Rides:** OTP-based ride initiation ensures you get in the right car.
* **SOS Emergency Alert:** One-tap SOS button that logs the event and prompts a call to emergency services.
* **Post-Ride Rating System:** Rate drivers and provide textual feedback after trip completion.
* **Payment Flexibility:** Choose between Cash or Online payment modes seamlessly.

### 🚘 For Drivers
* **Status Management:** Toggle Online/Offline status effortlessly from the home screen.
* **Interactive Ride Requests:** Receive rich in-app modals and push notifications for incoming rides with precise distance and fare details.
* **In-App Navigation:** Deep linking to Google Maps/Apple Maps for turn-by-turn pickup and drop-off routing.
* **Ride Lifecycle Control:** Manage the entire trip logically (Accept ➔ Navigate ➔ Start Ride via OTP ➔ End Ride).

---

## 🛠️ Tech Stack & Architecture

### **Frontend (Mobile App)**
* **Framework:** React Native / Expo
* **Maps & Routing:** `react-native-maps`, `react-native-maps-directions`, Google Places API
* **State & Real-time:** React Context API, `socket.io-client`

### **Backend (API & WebSockets)**
* **Core:** Node.js, Express.js
* **Database:** MySQL (Cloud/Local) via `mysql2` connection pooling.
* **In-Memory Cache & Pub/Sub:** **Redis** (Upstash) - *Used for tracking ephemeral socket connections and scaling WebSocket instances across multiple servers.*
* **Real-time Engine:** Socket.io
* **Security:** JWT Authentication, `bcryptjs` for password hashing.

---

## 🚀 Getting Started

Follow these instructions to set up the project locally on your machine.

### Prerequisites
1. **Node.js** (v18+ recommended)
2. **MySQL** Database (Local or Cloud like TiDB/PlanetScale)
3. **Redis** Database (Use [Upstash](https://upstash.com) for a free serverless Redis instance)
4. **Expo CLI** (`npm install -g expo-cli`)
5. **Google Maps API Key** (with Maps SDK, Places API, and Directions API enabled)

---

### 1️⃣ Backend Setup

1. Open your terminal and navigate to the backend directory:
   ```bash
   cd backend

5. **Google Maps API Key**

   * Maps SDK
   * Places API
   * Directions API

---

## 1️⃣ Backend Setup

Navigate to the backend directory:

```bash
cd backend
```

Install dependencies:

```bash
npm install
```

### Environment Configuration

Create a `.env` file inside the `/backend` directory:

```env
PORT=3000
DB_HOST=your_mysql_host
DB_USER=your_mysql_user
DB_PASSWORD=your_mysql_password
DB_NAME=cab_booking
JWT_SECRET=your_super_secret_jwt_key
REDIS_URL=redis://default:password@your-upstash-url.upstash.io:port
```

### Database Initialization

Run the database setup script:

```bash
node setup_db.js
```

### Start Backend Server

```bash
npm start
```

---

## 2️⃣ Frontend Setup

Navigate to the frontend directory:

```bash
cd frontend
```

Install dependencies:

```bash
npm install
```

### Environment Configuration

Create a `.env` file inside the `/frontend` directory:

```env
# Use your computer's local IPv4 address for testing on a physical device
# Example: http://192.168.1.100:3000
EXPO_PUBLIC_SERVER_URL=http://your-backend-ip:3000

# Google Maps API Key
EXPO_PUBLIC_GOOGLE_API_KEY=AIzaSyYourGoogleApiKeyHere
```

### Start Expo Development Server

```bash
npx expo start
```

Scan the QR code using the **Expo Go** app on Android or iOS, or run the app on a simulator.

---

## 📡 WebSocket Architecture Flow

To ensure the system scales efficiently without losing active rides during server restarts, the real-time architecture utilizes **Redis**.

### 🔹 Connection Handling

* When a user logs in, their `socket.id` is mapped to their `userId` or `driverId`
* The mapping is stored in Redis with an auto-expiring TTL (Time-To-Live)

### 🔹 Driver Location Pings

* Drivers emit GPS coordinates every **5 seconds**
* Backend:

  * Persists the location in MySQL
  * Instantly broadcasts updates via Socket.io

### 🔹 Ride Matching

* When a rider requests a cab:

  * Backend calculates the nearest available driver using the **Haversine distance algorithm**
  * Fetches the driver's active `socket.id` from Redis
  * Emits a targeted `newRideRequest` event to the driver

### 🔹 Resilience & Fault Tolerance

* Socket state is decoupled from server memory
* Multiple Node.js instances remain in sync
* Active rides continue even if a server crashes or restarts

---

## 🔮 Future Roadmap

* [ ] **Spatial Indexing**
  Migrate Haversine calculations to `ST_Distance_Sphere` for optimized geospatial queries.
* [ ] **Driver Wallet System**
  Earnings ledger, payouts, and payment gateway integration (Razorpay / Stripe).
* [ ] **Background Location Tracking**
  Continuous driver tracking using Expo Background Fetch.
* [ ] **Advanced Analytics Dashboard**
  Admin insights into peak hours, popular routes, and surge pricing efficiency.

---

## 📄 License

MIT License

---

## 🤝 Contributing

Pull requests are welcome.
For major changes, please open an issue first to discuss what you would like to change.

---

### ⭐ If you like this project, don’t forget to star the repository!

```
```
