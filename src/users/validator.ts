import { integer } from 'drizzle-orm/pg-core'
import { z } from 'zod'


export const usersSchema = z.object({
      full_name: z.string(),
      email: z.string(),
      contact_phone: z.string(),
      address: z.string(),
      role: z.string()
})

