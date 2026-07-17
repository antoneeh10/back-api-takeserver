# Guide to Adding API

This guide explains how to add a new API endpoint to the Takeserver API project.

---

# Requirements

Before creating a new API, make sure you have:

- Node.js installed
- npm installed
- Git
- Basic knowledge of TypeScript or JavaScript
- A code editor (VS Code recommended)

---

# Project Structure

Example structure:

```
src/
├── routes/
├── controllers/
├── services/
├── middleware/
├── utils/
└── index.ts
```

---

# Step 1 - Create a Route

Create a new file inside the `routes` folder.

Example:

```
src/routes/example.ts
```

```ts
import { Router } from "express";
import { getExample } from "../controllers/example";

const router = Router();

router.get("/", getExample);

export default router;
```

---

# Step 2 - Create a Controller

Create a controller inside the `controllers` folder.

Example:

```
src/controllers/example.ts
```

```ts
import { Request, Response } from "express";

export const getExample = async (
  req: Request,
  res: Response
) => {
  res.json({
    success: true,
    message: "Hello from Takeserver API"
  });
};
```

---

# Step 3 - Register the Route

Open your main server file.

Example:

```ts
import exampleRoute from "./routes/example";

app.use("/api/example", exampleRoute);
```

---

# Step 4 - Test the Endpoint

Start the server.

```bash
npm run dev
```

Visit:

```
GET /api/example
```

Expected response:

```json
{
  "success": true,
  "message": "Hello from Takeserver API"
}
```

---

# API Response Standard

Every endpoint should return a consistent response format.

Success:

```json
{
  "success": true,
  "data": {}
}
```

Error:

```json
{
  "success": false,
  "message": "Something went wrong"
}
```

---

# Naming Convention

Routes

```
/api/users
/api/posts
/api/weather
```

Files

```
users.ts
posts.ts
weather.ts
```

Functions

```ts
getUsers()
createUser()
deleteUser()
updateUser()
```

---

# Error Handling

Always wrap asynchronous code with `try...catch`.

```ts
try {
    // your code
} catch (error) {
    res.status(500).json({
        success: false,
        message: "Internal Server Error"
    });
}
```

---

# Best Practices

- Keep routes clean.
- Put business logic inside controllers or services.
- Validate user input.
- Return proper HTTP status codes.
- Use meaningful variable names.
- Keep code readable.

---

# Pull Request Checklist

Before submitting your Pull Request, make sure you have:

- [ ] Tested your endpoint
- [ ] No TypeScript errors
- [ ] No ESLint errors (if applicable)
- [ ] Updated documentation (if needed)
- [ ] Used the standard response format
- [ ] Written clean and readable code

---

# Example Endpoint

```http
GET /api/example
```

Response:

```json
{
  "success": true,
  "message": "Hello from Takeserver API"
}
```

---

# Need Help?

If you have any questions or need assistance, feel free to open an Issue or start a discussion in this repository.

Happy coding! 🚀
