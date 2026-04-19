# API Endpoints - Horse Show Results App

## Overview

Complete REST API endpoint reference for core CRUD operations (Create, Read, Update, Delete) on all resources.

**Base URL:** `http://localhost:8000` (development) | `https://api.horseshowresults.com` (production)  
**Authentication:** JWT Bearer Token  
**Response Format:** JSON  
**API Version:** 1.0  

---

## Authentication

### Login
**POST** `/auth/login`

Authenticate with email and password to receive JWT token.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

**Response (200 OK):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "expires_in": 86400,
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "full_name": "John Scorekeeper",
    "role": "SCOREKEEPER"
  }
}
```

---

## Venues Resource

### List Venues
**GET** `/venues`

Retrieve all venues.

**Request:**
```
GET /venues
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
  "venues": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "name": "Lone Star Arena",
      "address": "123 Ranch Road",
      "city": "Austin",
      "state": "TX",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

---

### Create Venue
**POST** `/venues`

Create a new venue (Admin only).

**Headers:**
```
Authorization: Bearer <admin_token>
Content-Type: application/json
```

**Request:**
```json
{
  "name": "Lone Star Arena",
  "address": "123 Ranch Road",
  "city": "Austin",
  "state": "TX"
}
```

**Response (201 Created):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "name": "Lone Star Arena",
  "address": "123 Ranch Road",
  "city": "Austin",
  "state": "TX",
  "created_at": "2024-01-15T10:30:00Z"
}
```

---

### Get Venue
**GET** `/venues/{venue_id}`

Retrieve a specific venue.

**Response (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "name": "Lone Star Arena",
  "address": "123 Ranch Road",
  "city": "Austin",
  "state": "TX",
  "created_at": "2024-01-15T10:30:00Z"
}
```

---

### Update Venue
**PUT** `/venues/{venue_id}`

Update a venue (Admin only).

**Request:**
```json
{
  "address": "456 New Road"
}
```

**Response (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "name": "Lone Star Arena",
  "address": "456 New Road",
  "city": "Austin",
  "state": "TX",
  "created_at": "2024-01-15T10:30:00Z"
}
```

---

### Delete Venue
**DELETE** `/venues/{venue_id}`

Delete a venue (Admin only).

**Response (204 No Content)**

---

## Shows Resource

### List Shows
**GET** `/shows`

Retrieve all shows with optional filtering and pagination.

**Query Parameters:**
```
?page=1&limit=20&status=ACTIVE
```

**Response (200 OK):**
```json
{
  "shows": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440010",
      "name": "Spring Show 2024",
      "venue_id": "550e8400-e29b-41d4-a716-446655440001",
      "start_date": "2024-05-15",
      "end_date": "2024-05-17",
      "status": "ACTIVE",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ],
  "total": 5,
  "page": 1,
  "limit": 20
}
```

---

### Create Show
**POST** `/shows`

Create a new show (Admin only).

**Request:**
```json
{
  "name": "Spring Show 2024",
  "venue_id": "550e8400-e29b-41d4-a716-446655440001",
  "start_date": "2024-05-15",
  "end_date": "2024-05-17",
  "status": "DRAFT"
}
```

**Response (201 Created):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440010",
  "name": "Spring Show 2024",
  "venue_id": "550e8400-e29b-41d4-a716-446655440001",
  "start_date": "2024-05-15",
  "end_date": "2024-05-17",
  "status": "DRAFT",
  "created_at": "2024-01-15T10:30:00Z"
}
```

---

### Get Show
**GET** `/shows/{show_id}`

Retrieve a specific show with related resources.

**Response (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440010",
  "name": "Spring Show 2024",
  "venue_id": "550e8400-e29b-41d4-a716-446655440001",
  "venue": {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "name": "Lone Star Arena"
  },
  "start_date": "2024-05-15",
  "end_date": "2024-05-17",
  "status": "ACTIVE",
  "rings": [...],
  "divisions": [...],
  "classes": [...],
  "created_at": "2024-01-15T10:30:00Z"
}
```

---

### Update Show
**PUT** `/shows/{show_id}`

Update a show (Admin only).

**Request:**
```json
{
  "status": "ACTIVE"
}
```

**Response (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440010",
  "name": "Spring Show 2024",
  "venue_id": "550e8400-e29b-41d4-a716-446655440001",
  "start_date": "2024-05-15",
  "end_date": "2024-05-17",
  "status": "ACTIVE",
  "created_at": "2024-01-15T10:30:00Z"
}
```

---

### Delete Show
**DELETE** `/shows/{show_id}`

Delete a show and all related data (Admin only).

**Response (204 No Content)**

---

## Rings Resource

### Create Ring
**POST** `/shows/{show_id}/rings`

Create a new ring for a show (Admin only).

**Request:**
```json
{
  "name": "Ring A"
}
```

**Response (201 Created):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440020",
  "show_id": "550e8400-e29b-41d4-a716-446655440010",
  "name": "Ring A"
}
```

---

### Get Rings
**GET** `/shows/{show_id}/rings`

List all rings for a show.

**Response (200 OK):**
```json
{
  "rings": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440020",
      "show_id": "550e8400-e29b-41d4-a716-446655440010",
      "name": "Ring A"
    }
  ]
}
```

---

### Update Ring
**PUT** `/rings/{ring_id}`

Update a ring (Admin only).

**Request:**
```json
{
  "name": "Indoor Ring A"
}
```

**Response (200 OK)**

---

### Delete Ring
**DELETE** `/rings/{ring_id}`

Delete a ring (Admin only).

**Response (204 No Content)**

---

## Divisions Resource

### Create Division
**POST** `/shows/{show_id}/divisions`

Create a new division for a show (Admin only).

**Request:**
```json
{
  "name": "Youth"
}
```

**Response (201 Created):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440030",
  "show_id": "550e8400-e29b-41d4-a716-446655440010",
  "name": "Youth"
}
```

---

### Get Divisions
**GET** `/shows/{show_id}/divisions`

List all divisions for a show.

**Response (200 OK):**
```json
{
  "divisions": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440030",
      "show_id": "550e8400-e29b-41d4-a716-446655440010",
      "name": "Youth"
    }
  ]
}
```

---

### Update Division
**PUT** `/divisions/{division_id}`

Update a division (Admin only).

**Request:**
```json
{
  "name": "Youth Division"
}
```

**Response (200 OK)**

---

### Delete Division
**DELETE** `/divisions/{division_id}`

Delete a division (Admin only).

**Response (204 No Content)**

---

## Classes Resource

### Create Class
**POST** `/shows/{show_id}/classes`

Create a new class for a show (Admin only).

**Request:**
```json
{
  "ring_id": "550e8400-e29b-41d4-a716-446655440020",
  "division_id": "550e8400-e29b-41d4-a716-446655440030",
  "class_number": "101",
  "class_name": "Western Pleasure",
  "class_date": "2024-05-15",
  "status": "OPEN"
}
```

**Response (201 Created):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440040",
  "show_id": "550e8400-e29b-41d4-a716-446655440010",
  "ring_id": "550e8400-e29b-41d4-a716-446655440020",
  "division_id": "550e8400-e29b-41d4-a716-446655440030",
  "class_number": "101",
  "class_name": "Western Pleasure",
  "class_date": "2024-05-15",
  "status": "OPEN",
  "created_at": "2024-01-15T10:30:00Z"
}
```

---

### List Classes
**GET** `/shows/{show_id}/classes`

List all classes for a show.

**Query Parameters:**
```
?status=OPEN&ring_id=550e8400-e29b-41d4-a716-446655440020
```

**Response (200 OK):**
```json
{
  "classes": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440040",
      "show_id": "550e8400-e29b-41d4-a716-446655440010",
      "ring_id": "550e8400-e29b-41d4-a716-446655440020",
      "division_id": "550e8400-e29b-41d4-a716-446655440030",
      "class_number": "101",
      "class_name": "Western Pleasure",
      "class_date": "2024-05-15",
      "status": "OPEN",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

---

### Get Class
**GET** `/classes/{class_id}`

Retrieve a specific class with entries.

**Response (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440040",
  "show_id": "550e8400-e29b-41d4-a716-446655440010",
  "class_number": "101",
  "class_name": "Western Pleasure",
  "class_date": "2024-05-15",
  "status": "OPEN",
  "entries": [...],
  "results": [...],
  "created_at": "2024-01-15T10:30:00Z"
}
```

---

### Update Class
**PUT** `/classes/{class_id}`

Update a class (Admin only).

**Request:**
```json
{
  "status": "IN_PROGRESS"
}
```

**Response (200 OK)**

---

### Delete Class
**DELETE** `/classes/{class_id}`

Delete a class (Admin only).

**Response (204 No Content)**

---

## Horses Resource

### List Horses
**GET** `/horses`

Retrieve all horses.

**Response (200 OK):**
```json
{
  "horses": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440050",
      "name": "Midnight",
      "owner_name": "John Smith",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

---

### Create Horse
**POST** `/horses`

Create a new horse.

**Request:**
```json
{
  "name": "Midnight",
  "owner_name": "John Smith"
}
```

**Response (201 Created):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440050",
  "name": "Midnight",
  "owner_name": "John Smith",
  "created_at": "2024-01-15T10:30:00Z"
}
```

---

### Get Horse
**GET** `/horses/{horse_id}`

Retrieve a specific horse with exhibitors.

**Response (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440050",
  "name": "Midnight",
  "owner_name": "John Smith",
  "exhibitors": [...],
  "created_at": "2024-01-15T10:30:00Z"
}
```

---

### Update Horse
**PUT** `/horses/{horse_id}`

Update a horse.

**Request:**
```json
{
  "owner_name": "Jane Smith"
}
```

**Response (200 OK)**

---

### Delete Horse
**DELETE** `/horses/{horse_id}`

Delete a horse.

**Response (204 No Content)**

---

## Exhibitors Resource

### List Exhibitors
**GET** `/exhibitors`

Retrieve all exhibitors.

**Query Parameters:**
```
?page=1&limit=20&search=smith
```

**Response (200 OK):**
```json
{
  "exhibitors": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440060",
      "full_name": "Jane Smith",
      "user_id": null,
      "created_at": "2024-01-15T10:30:00Z"
    }
  ],
  "total": 15,
  "page": 1,
  "limit": 20
}
```

---

### Create Exhibitor
**POST** `/exhibitors`

Create a new exhibitor.

**Request:**
```json
{
  "full_name": "Jane Smith",
  "user_id": null
}
```

**Response (201 Created):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440060",
  "full_name": "Jane Smith",
  "user_id": null,
  "created_at": "2024-01-15T10:30:00Z"
}
```

---

### Get Exhibitor
**GET** `/exhibitors/{exhibitor_id}`

Retrieve a specific exhibitor with horses and entries.

**Response (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440060",
  "full_name": "Jane Smith",
  "user_id": null,
  "horses": [...],
  "show_entries": [...],
  "created_at": "2024-01-15T10:30:00Z"
}
```

---

### Update Exhibitor
**PUT** `/exhibitors/{exhibitor_id}`

Update an exhibitor.

**Request:**
```json
{
  "full_name": "Jane Doe Smith"
}
```

**Response (200 OK)**

---

### Delete Exhibitor
**DELETE** `/exhibitors/{exhibitor_id}`

Delete an exhibitor.

**Response (204 No Content)**

---

## Exhibitor Horses Resource

### Link Horse to Exhibitor
**POST** `/exhibitors/{exhibitor_id}/horses/{horse_id}`

Associate a horse with an exhibitor.

**Response (201 Created):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440070",
  "exhibitor_id": "550e8400-e29b-41d4-a716-446655440060",
  "horse_id": "550e8400-e29b-41d4-a716-446655440050",
  "created_at": "2024-01-15T10:30:00Z"
}
```

---

### Get Exhibitor Horses
**GET** `/exhibitors/{exhibitor_id}/horses`

Get all horses for an exhibitor.

**Response (200 OK):**
```json
{
  "horses": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440050",
      "name": "Midnight",
      "owner_name": "John Smith"
    }
  ]
}
```

---

### Unlink Horse
**DELETE** `/exhibitors/{exhibitor_id}/horses/{horse_id}`

Remove a horse from an exhibitor.

**Response (204 No Content)**

---

## Show Entries Resource

### Register Exhibitor for Show
**POST** `/shows/{show_id}/exhibitors/{exhibitor_id}`

Register an exhibitor for a show and assign back number.

**Request:**
```json
{
  "back_number": 42
}
```

**Response (201 Created):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440080",
  "show_id": "550e8400-e29b-41d4-a716-446655440010",
  "exhibitor_id": "550e8400-e29b-41d4-a716-446655440060",
  "back_number": 42,
  "created_at": "2024-01-15T10:30:00Z"
}
```

---

### Get Show Entries
**GET** `/shows/{show_id}/entries`

List all exhibitors registered for a show.

**Response (200 OK):**
```json
{
  "entries": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440080",
      "show_id": "550e8400-e29b-41d4-a716-446655440010",
      "exhibitor_id": "550e8400-e29b-41d4-a716-446655440060",
      "exhibitor_name": "Jane Smith",
      "back_number": 42,
      "created_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

---

### Update Show Entry
**PUT** `/show-entries/{show_entry_id}`

Update a show entry (e.g., change back number).

**Request:**
```json
{
  "back_number": 43
}
```

**Response (200 OK)**

---

### Unregister from Show
**DELETE** `/show-entries/{show_entry_id}`

Remove exhibitor from show.

**Response (204 No Content)**

---

## Entries Resource

### Create Entry
**POST** `/classes/{class_id}/entries`

Enter an exhibitor and horse into a class.

**Request:**
```json
{
  "exhibitor_id": "550e8400-e29b-41d4-a716-446655440060",
  "horse_id": "550e8400-e29b-41d4-a716-446655440050",
  "back_number": 42
}
```

**Response (201 Created):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440090",
  "class_id": "550e8400-e29b-41d4-a716-446655440040",
  "exhibitor_id": "550e8400-e29b-41d4-a716-446655440060",
  "horse_id": "550e8400-e29b-41d4-a716-446655440050",
  "back_number": 42,
  "status": "ENTERED",
  "created_at": "2024-01-15T10:30:00Z"
}
```

---

### Get Class Entries
**GET** `/classes/{class_id}/entries`

List all entries for a class.

**Response (200 OK):**
```json
{
  "entries": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440090",
      "class_id": "550e8400-e29b-41d4-a716-446655440040",
      "exhibitor_id": "550e8400-e29b-41d4-a716-446655440060",
      "exhibitor_name": "Jane Smith",
      "horse_id": "550e8400-e29b-41d4-a716-446655440050",
      "horse_name": "Midnight",
      "back_number": 42,
      "status": "ENTERED",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

---

### Get Entry
**GET** `/entries/{entry_id}`

Retrieve a specific entry with result if exists.

**Response (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440090",
  "class_id": "550e8400-e29b-41d4-a716-446655440040",
  "exhibitor_id": "550e8400-e29b-41d4-a716-446655440060",
  "exhibitor_name": "Jane Smith",
  "horse_id": "550e8400-e29b-41d4-a716-446655440050",
  "horse_name": "Midnight",
  "back_number": 42,
  "status": "ENTERED",
  "result": {
    "place": 1,
    "is_tie": false,
    "notes": null
  },
  "created_at": "2024-01-15T10:30:00Z"
}
```

---

### Update Entry
**PUT** `/entries/{entry_id}`

Update an entry (e.g., change status).

**Request:**
```json
{
  "status": "WITHDRAWN"
}
```

**Response (200 OK)**

---

### Delete Entry
**DELETE** `/entries/{entry_id}`

Delete an entry (removes associated results).

**Response (204 No Content)**

---

## Results Resource

### Create Result
**POST** `/classes/{class_id}/results`

Enter a result (placing) for an entry.

**Request:**
```json
{
  "entry_id": "550e8400-e29b-41d4-a716-446655440090",
  "place": 1,
  "is_tie": false,
  "notes": null
}
```

**Response (201 Created):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440100",
  "class_id": "550e8400-e29b-41d4-a716-446655440040",
  "entry_id": "550e8400-e29b-41d4-a716-446655440090",
  "place": 1,
  "is_tie": false,
  "notes": null,
  "created_at": "2024-01-15T10:30:00Z"
}
```

---

### Get Class Results
**GET** `/classes/{class_id}/results`

List all results for a class.

**Response (200 OK):**
```json
{
  "results": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440100",
      "class_id": "550e8400-e29b-41d4-a716-446655440040",
      "entry_id": "550e8400-e29b-41d4-a716-446655440090",
      "exhibitor_name": "Jane Smith",
      "horse_name": "Midnight",
      "back_number": 42,
      "place": 1,
      "is_tie": false,
      "notes": null,
      "created_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

---

### Get Result
**GET** `/results/{result_id}`

Retrieve a specific result with audit history.

**Response (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440100",
  "class_id": "550e8400-e29b-41d4-a716-446655440040",
  "entry_id": "550e8400-e29b-41d4-a716-446655440090",
  "place": 1,
  "is_tie": false,
  "notes": null,
  "audit_history": [
    {
      "changed_at": "2024-01-15T10:35:00Z",
      "changed_by": "John Scorekeeper",
      "old_place": 2,
      "new_place": 1
    }
  ],
  "created_at": "2024-01-15T10:30:00Z"
}
```

---

### Update Result
**PUT** `/results/{result_id}`

Update a result (Scorekeeper only).

**Request:**
```json
{
  "place": 2,
  "notes": "Placed second"
}
```

**Response (200 OK)**

---

### Delete Result
**DELETE** `/results/{result_id}`

Delete a result (removes from audit trail).

**Response (204 No Content)**

---

## Users Resource

### List Users
**GET** `/users`

Retrieve all users (Admin only).

**Response (200 OK):**
```json
{
  "users": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "user@example.com",
      "full_name": "John Scorekeeper",
      "role": "SCOREKEEPER",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

---

### Create User
**POST** `/users`

Create a new user (Admin only).

**Request:**
```json
{
  "email": "scorekeeper@example.com",
  "full_name": "Jane Scorekeeper",
  "password": "securepassword123",
  "role": "SCOREKEEPER"
}
```

**Response (201 Created):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440110",
  "email": "scorekeeper@example.com",
  "full_name": "Jane Scorekeeper",
  "role": "SCOREKEEPER",
  "created_at": "2024-01-15T10:30:00Z"
}
```

---

### Get User
**GET** `/users/{user_id}`

Retrieve a specific user (Admin or self).

**Response (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "full_name": "John Scorekeeper",
  "role": "SCOREKEEPER",
  "created_at": "2024-01-15T10:30:00Z"
}
```

---

### Update User
**PUT** `/users/{user_id}`

Update a user (Admin or self).

**Request:**
```json
{
  "full_name": "John Updated",
  "role": "ADMIN"
}
```

**Response (200 OK)**

---

### Delete User
**DELETE** `/users/{user_id}`

Delete a user (Admin only).

**Response (204 No Content)**

---

## Error Responses

### Common Error Codes

**400 Bad Request:**
```json
{
  "detail": "Invalid request",
  "errors": {
    "email": "Invalid email format"
  }
}
```

**401 Unauthorized:**
```json
{
  "detail": "Not authenticated"
}
```

**403 Forbidden:**
```json
{
  "detail": "Insufficient permissions"
}
```

**404 Not Found:**
```json
{
  "detail": "Resource not found"
}
```

**409 Conflict:**
```json
{
  "detail": "Entry already exists for this exhibitor/horse/class combination"
}
```

---

## Status Codes

| Code | Meaning | Use |
|------|---------|-----|
| 200 | OK | Successful GET/PUT |
| 201 | Created | Successful POST |
| 204 | No Content | Successful DELETE |
| 400 | Bad Request | Invalid input |
| 401 | Unauthorized | Missing auth |
| 403 | Forbidden | No permission |
| 404 | Not Found | Resource not found |
| 409 | Conflict | Duplicate/conflict |

---

