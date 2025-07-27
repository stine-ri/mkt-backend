
import { Context } from "hono";
import { usersService, getuserservice, createuserservice, updateuserservice, deleteuserservice,} from "./users.service";
import*as bcrypt from "bcrypt";
export const listUsers = async (c: Context) => {
    try {
        //limit the number of users to be returned

        const limit = Number(c.req.query('limit'))

        const data = await usersService(limit);
        if (data == null || data.length == 0) {
            return c.text("user not found", 404)
        }
        return c.json(data, 200);
    } catch (error: any) {
        return c.json({ error: error?.message }, 400)
    }
}

export const getUser = async (c: Context) => {
    const id = parseInt(c.req.param("id"));
    if (isNaN(id)) return c.text("Invalid ID", 400);

    const user = await getuserservice(id);
            if (user == undefined) {
        return c.text("user not found", 404);
    }
    return c.json(user, 200);
}
export const createUser = async (c: Context) => {
    try {
        const user = await c.req.json();
        const password=user.password;
        const hashedPassword=await bcrypt.hash(password,10);
        user.password=hashedPassword;
        const createduser = await createuserservice(user);


        if (!createduser) return c.text("user not created", 404);
        return c.json({ msg: createduser }, 201);

    } catch (error: any) {
        return c.json({ error: error?.message }, 400)
    }
}

export const updateUser = async (c: Context) => {
    const id = parseInt(c.req.param("id"));
    if (isNaN(id)) return c.text("Invalid ID", 400);

    const user = await c.req.json();
    try {
        // search for the user
        const searcheduser= await getuserservice(id);
        if (searcheduser == undefined) return c.text("user not found", 404);
        // get the data and update it
        const res = await updateuserservice(id, user);
        // return a success message
        if (!res) return c.text("user not updated", 404);

        return c.json({ msg: res }, 201);
    } catch (error: any) {
        return c.json({ error: error?.message }, 400)
    }
}

export const deleteUser = async (c: Context) => {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) return c.text("Invalid ID", 400);

    try {
        //search for the user
        const user = await getuserservice(id);
        if (user== undefined) return c.text("user not found", 404);
        //deleting the user
        const res = await deleteuserservice(id);
        if (!res) return c.text("user not deleted", 404);

        return c.json({ msg: res }, 201);
    } catch (error: any) {
        return c.json({ error: error?.message }, 400)
    }
}
 
 