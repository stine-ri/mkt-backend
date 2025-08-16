CREATE INDEX "idx_chat_rooms_client_id" ON "chat_rooms" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_chat_rooms_provider_id" ON "chat_rooms" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "idx_messages_chat_room_id" ON "messages" USING btree ("chat_room_id");--> statement-breakpoint
CREATE INDEX "idx_messages_sender_id" ON "messages" USING btree ("sender_id");