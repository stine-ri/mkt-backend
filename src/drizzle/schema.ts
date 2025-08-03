import {
    pgTable,
    serial,
    text,
    varchar,
    integer,
    primaryKey,
    decimal,
    boolean,
    timestamp,
    date,
    time,
    pgEnum,
     jsonb,
     numeric
  } from "drizzle-orm/pg-core";
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
  avatar: varchar('avatar', { length: 255 }), 
    role: roleEnum("role").default("client").notNull(),
    created_at: timestamp("created_at").defaultNow(),
    updated_at: timestamp("updated_at").defaultNow(),
  });
  
  // Authentication Table
export const Authentication = pgTable("authentication", {
    auth_id: serial("auth_id").primaryKey(),
    user_id: integer("user_id").notNull().references(() => users.id,{onDelete:"cascade"}),
    password: varchar("password"),
    email: varchar("email", { length: 255 }).unique(),
    role: roleEnum("role").default("client"),
    created_at: timestamp("created_at").defaultNow(),
    updated_at: timestamp("updated_at").defaultNow(),
});

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
  profileImageUrl: varchar('profile_image_url', { length: 500 }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const providerServices = pgTable('provider_services', {
  providerId: integer('provider_id').notNull().references(() => providers.id),
  serviceId: integer('service_id').notNull().references(() => services.id),
}, (t) => ({
  pk: primaryKey(t.providerId, t.serviceId),
}));

// Requests table - defined without circular reference first
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
  allowInterests: boolean('allow_interests').default(true),
  allowBids: boolean('allow_bids').default(true),
  // Store accepted bid ID without foreign key constraint to avoid circular dependency
  accepted_bid_id: integer('accepted_bid_id'),
  
  createdAt: timestamp('created_at').defaultNow(),
});

// Bids table
export const bids = pgTable('bids', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  requestId: integer('request_id').notNull().references(() => requests.id),
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
  requestId: integer('request_id'),
  isRead: boolean('is_read').default(false),
  createdAt: timestamp('created_at').defaultNow(),
});
export const interests = pgTable('interests', {
  id: serial('id').primaryKey(),
  requestId: integer('request_id')
    .references(() => requests.id, { onDelete: 'cascade' }),
  providerId: integer('provider_id')
    .references(() => providers.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow(),
  message: text('message'),
  isShortlisted: boolean('is_shortlisted').default(false),
  status: text('status').default('pending').notNull(),
});

export const chatRooms = pgTable('chat_rooms', {
  id: serial('id').primaryKey(),
  requestId: integer('request_id').notNull().references(() => requests.id),
  clientId: integer('client_id').notNull().references(() => users.id),
  providerId: integer('provider_id').notNull().references(() => users.id),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});


export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  chatRoomId: integer('chat_room_id').notNull().references(() => chatRooms.id),
  senderId: integer('sender_id').notNull().references(() => users.id),
  content: text('content').notNull(),
  isSystem: boolean('is_system').notNull().default(false),
  read: boolean('read').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow()
});

export const paymentAgreements = pgTable('payment_agreements', {
  id: serial('id').primaryKey(),
  chatRoomId: integer('chat_room_id').notNull().references(() => chatRooms.id),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  paymentMethod: text('payment_method').notNull(),
  terms: text('terms'),
  status: text('status').notNull().default('pending'), // pending, accepted, completed
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
});
// Define all relations
export const authenticationRelations = relations(Authentication, ({ one }) => ({
    user: one(users, {
        fields: [Authentication.user_id],
        references: [users.id],
    }),
}));

export const userRelations = relations(users, ({ many }) => ({
  authentication: many(Authentication),
  providers: many(providers),
  requests: many(requests),
  bids: many(bids),
}));

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
  interests: many(interests),
}));

export const collegeRelations = relations(colleges, ({ many }) => ({
  providers: many(providers),
  requests: many(requests),
}));

export const serviceRelations = relations(services, ({ many }) => ({
  providerServices: many(providerServices),
  requests: many(requests),
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

export const requestsRelations = relations(requests, ({ one, many }) => ({
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
  interests: many(interests),
  bids: many(bids),
  // Handle the circular dependency through relations
  acceptedBid: one(bids, {
    fields: [requests.accepted_bid_id],
    references: [bids.id],
  }),
}));

export const bidsRelations = relations(bids, ({ one }) => ({
  user: one(users, {
    fields: [bids.userId],
    references: [users.id],
  }),
  request: one(requests, {
    fields: [bids.requestId],
    references: [requests.id],
  }),
  provider: one(providers, {
    fields: [bids.providerId],
    references: [providers.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
}));
export const interestsRelations = relations(interests, ({ one }) => ({
  request: one(requests, {
    fields: [interests.requestId],
    references: [requests.id],
  }),
  provider: one(providers, {
    fields: [interests.providerId],
    references: [providers.id],
  }),
}));
// Export types for TypeScript support
export type TIUsers = typeof users.$inferInsert;
export type TSUsers = typeof users.$inferSelect;

export type TIAuthentication = typeof Authentication.$inferInsert;
export type TSAuthentication = typeof Authentication.$inferSelect;

export type TIProviders = typeof providers.$inferInsert;
export type TSProviders = typeof providers.$inferSelect;

export type TIRequests = typeof requests.$inferInsert;
export type TSRequests = typeof requests.$inferSelect;

export type TIBids = typeof bids.$inferInsert;
export type TSBids = typeof bids.$inferSelect;

export type TIColleges = typeof colleges.$inferInsert;
export type TSColleges = typeof colleges.$inferSelect;

export type TIServices = typeof services.$inferInsert;
export type TSServices = typeof services.$inferSelect;

export type TINotifications = typeof notifications.$inferInsert;
export type TSNotifications = typeof notifications.$inferSelect;