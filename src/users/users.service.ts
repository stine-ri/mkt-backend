
import { eq } from "drizzle-orm";
import db from "../drizzle/db.js";
import { TIUsers, TSUsers, users, } from "../drizzle/schema.js";

export const usersService = async (limit?: number): Promise<TSUsers[] | null> => {
    if (limit) {
        return await db.query.users.findMany({
            limit: limit
        });
    }
    return await db.query.users.findMany();
}

export const getuserservice = async (id: number): Promise<TIUsers | undefined> => {
    return await db.query.users.findFirst({
        where: eq(users.id, id)
    })
}

export const createuserservice = async (user: TIUsers) => {
    await db.insert(users).values(user)
    return "user created successfully";
}

export const updateuserservice = async (id: number, user: TIUsers) => {
    await db.update(users).set(user).where(eq(users.id, id))
    return "user updated successfully";
}

export const deleteuserservice = async (id: number) => {
    await db.delete(users).where(eq(users.id, id))
    return "user deleted successfully";
}
