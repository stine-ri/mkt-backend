import { eq } from "drizzle-orm";
import db from "../drizzle/db";
import { users, } from "../drizzle/schema";
export const usersService = async (limit) => {
    if (limit) {
        return await db.query.users.findMany({
            limit: limit
        });
    }
    return await db.query.users.findMany();
};
export const getuserservice = async (id) => {
    return await db.query.users.findFirst({
        where: eq(users.id, id)
    });
};
export const createuserservice = async (user) => {
    await db.insert(users).values(user);
    return "user created successfully";
};
export const updateuserservice = async (id, user) => {
    await db.update(users).set(user).where(eq(users.id, id));
    return "user updated successfully";
};
export const deleteuserservice = async (id) => {
    await db.delete(users).where(eq(users.id, id));
    return "user deleted successfully";
};
