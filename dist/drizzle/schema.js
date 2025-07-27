import { pgTable, serial, text, varchar, integer, primaryKey, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
// Enums
export const roleEnum = pgEnum("role", ["admin", "service_provider", "client"]);
// Users Table
export const users = pgTable("users", {
    id: serial("user_id").primaryKey(),
    full_name: text("full_name").notNull(),
    email: varchar("email", { length: 255 }).unique().notNull(),
    contact_phone: varchar("contact_phone", { length: 20 }),
    address: text("address"),
    role: roleEnum("role").default("client").notNull(),
    created_at: timestamp("created_at").defaultNow(),
    updated_at: timestamp("updated_at").defaultNow(),
});
// Authentication Table
export const Authentication = pgTable("authentication", {
    auth_id: serial("auth_id").primaryKey(),
    user_id: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    password: varchar("password"),
    email: varchar("email", { length: 255 }).unique(),
    role: roleEnum("role").default("client"),
    created_at: timestamp("created_at").defaultNow(),
    updated_at: timestamp("updated_at").defaultNow(),
});
export const authenticationRelations = relations(Authentication, ({ one }) => ({
    user: one(users, {
        fields: [Authentication.user_id],
        references: [users.id],
    }),
}));
export const providers = pgTable('providers', {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id),
    firstName: varchar('first_name', { length: 100 }).notNull(),
    lastName: varchar('last_name', { length: 100 }).notNull(),
    phoneNumber: varchar('phone_number', { length: 20 }).notNull(),
    collegeId: integer('college_id').references(() => colleges.id),
    latitude: varchar('latitude', { length: 50 }),
    longitude: varchar('longitude', { length: 50 }),
    address: text('address'),
    bio: text('bio'),
    isProfileComplete: boolean('is_profile_complete').default(false),
    rating: integer('rating'),
    completedRequests: integer('completed_requests').default(0),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});
export const providerServices = pgTable('provider_services', {
    providerId: integer('provider_id').notNull().references(() => providers.id),
    serviceId: integer('service_id').notNull().references(() => services.id),
}, (t) => ({
    pk: primaryKey(t.providerId, t.serviceId),
}));
export const colleges = pgTable('colleges', {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    location: varchar('location', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow(),
});
export const services = pgTable('services', {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    category: varchar('category', { length: 100 }),
    description: text('description'),
    createdAt: timestamp('created_at').defaultNow(),
});
export const requests = pgTable('requests', {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id),
    serviceId: integer('service_id').references(() => services.id),
    productName: varchar('product_name', { length: 255 }),
    isService: boolean('is_service').notNull(),
    description: text('description'),
    desiredPrice: integer('desired_price').notNull(),
    location: varchar('location', { length: 255 }).notNull(),
    collegeFilterId: integer('college_filter_id').references(() => colleges.id),
    status: varchar('status', { enum: ['open', 'closed', 'pending'] }).default('open'),
    createdAt: timestamp('created_at').defaultNow(),
});
export const bids = pgTable('bids', {
    id: serial('id').primaryKey(),
    requestId: integer('request_id').references(() => requests.id),
    providerId: integer('provider_id').references(() => providers.id),
    price: integer('price').notNull(),
    message: text('message'),
    isGraduateOfRequestedCollege: boolean('is_graduate_of_requested_college').notNull(),
    status: varchar('status', { enum: ['pending', 'accepted', 'rejected'] }).default('pending'),
    createdAt: timestamp('created_at').defaultNow(),
});
export const notifications = pgTable('notifications', {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull(),
    type: varchar('type', { length: 50 }).notNull(),
    message: text('message').notNull(),
    relatedEntityId: integer('related_entity_id'),
    isRead: boolean('is_read').default(false),
    createdAt: timestamp('created_at').defaultNow(),
});
// Define relations
export const providerRelations = relations(providers, ({ many, one }) => ({
    user: one(users, {
        fields: [providers.userId],
        references: [users.id],
    }),
    college: one(colleges, {
        fields: [providers.collegeId],
        references: [colleges.id],
    }),
    services: many(providerServices),
    bids: many(bids),
}));
export const requestRelations = relations(requests, ({ one }) => ({
    user: one(users, {
        fields: [requests.userId],
        references: [users.id],
    }),
    service: one(services, {
        fields: [requests.serviceId],
        references: [services.id],
    }),
    college: one(colleges, {
        fields: [requests.collegeFilterId],
        references: [colleges.id],
    }),
}));
export const requestsRelations = relations(requests, ({ many }) => ({
    bids: many(bids),
}));
export const bidsRelations = relations(bids, ({ one }) => ({
    request: one(requests, {
        fields: [bids.requestId],
        references: [requests.id],
    }),
    provider: one(providers, {
        fields: [bids.providerId],
        references: [providers.id],
    }),
}));
export const providerServiceRelations = relations(providerServices, ({ one }) => ({
    provider: one(providers, {
        fields: [providerServices.providerId],
        references: [providers.id],
    }),
    service: one(services, {
        fields: [providerServices.serviceId],
        references: [services.id],
    }),
}));
export const serviceRelations = relations(services, ({ many }) => ({
    providerServices: many(providerServices),
}));
