# Store Rating App

Users rate stores from 1 to 5. Everyone uses the same login page, and what you see depends on your role: **Admin**, **Normal User** or **Store Owner**.

Built with Node.js + Express, MySQL, and plain HTML / CSS / JavaScript.




## Rules checked by the app
- Name: 20-60 characters
- Address: up to 400 characters
- Password: 8-16 characters, one capital letter, one special character
- Email: normal email format
- Rating: whole number 1-5, one rating per user per store (changing it updates the old one)

## Folders
```
backend/
  config.js     <- your MySQL username and password go here
  server.js     API, login, validation
  schema.sql    database tables
frontend/
  index.html, style.css, app.js
```
