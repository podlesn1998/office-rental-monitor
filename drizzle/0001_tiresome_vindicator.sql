CREATE TABLE `listings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`platform` enum('cian','avito','yandex') NOT NULL,
	`platformId` varchar(128) NOT NULL,
	`title` text,
	`address` text,
	`district` varchar(256),
	`metroStation` varchar(256),
	`metroDistanceMin` int,
	`metroDistanceType` varchar(32),
	`price` bigint,
	`area` int,
	`floor` int,
	`totalFloors` int,
	`description` text,
	`photos` json,
	`url` text NOT NULL,
	`phone` varchar(64),
	`isNew` boolean NOT NULL DEFAULT true,
	`isSent` boolean NOT NULL DEFAULT false,
	`firstSeen` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`lastSeen` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `listings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scrapeLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`platform` enum('cian','avito','yandex','all') NOT NULL,
	`startedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`finishedAt` timestamp,
	`found` int DEFAULT 0,
	`newCount` int DEFAULT 0,
	`sentCount` int DEFAULT 0,
	`status` enum('running','success','error') NOT NULL DEFAULT 'running',
	`errorMessage` text,
	CONSTRAINT `scrapeLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `searchConfig` (
	`id` int AUTO_INCREMENT NOT NULL,
	`minArea` int NOT NULL DEFAULT 40,
	`maxArea` int NOT NULL DEFAULT 70,
	`minPrice` bigint NOT NULL DEFAULT 50000,
	`maxPrice` bigint NOT NULL DEFAULT 90000,
	`footMin` int NOT NULL DEFAULT 45,
	`metroStations` json,
	`city` varchar(64) NOT NULL DEFAULT 'Санкт-Петербург',
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `searchConfig_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `telegramConfig` (
	`id` int AUTO_INCREMENT NOT NULL,
	`botToken` varchar(256),
	`chatId` varchar(64),
	`active` boolean NOT NULL DEFAULT false,
	`initialBulkSent` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `telegramConfig_id` PRIMARY KEY(`id`)
);
