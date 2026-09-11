.PHONY: install dev dev-staging dev-worker build start worker lint format test test-watch test-cov test-e2e test-single prisma-generate prisma-migrate prisma-deploy prisma-seed prisma-studio prisma-reset docker-up docker-down docker-redis docker-logs git-status git-log git-pull git-commit git-push

install:
	npm install

dev:
	npm run start:dev

dev-staging:
	npm run start:staging:dev

dev-worker:
	npm run start:dev:worker

build:
	npm run build

start:
	npm run start:prod

worker:
	npm run start:worker

marketing-worker: 
	npm run start:marketing-worker

dev-marketing-worker:
	npm run start:dev:marketing-worker

lint:
	npm run lint

format:
	npm run format

test:
	npm test

test-watch:
	npm run test:watch

test-cov:
	npm run test:cov

test-e2e:
	npm run test:e2e

test-single:
	npx jest $(path)

prisma-generate:
	npx prisma generate

prisma-migrate:
	npx prisma migrate dev --name "$(name)"

prisma-deploy:
	npx prisma migrate deploy

prisma-seed:
	npx prisma db seed

prisma-studio:
	npx prisma studio

prisma-reset:
	npx prisma migrate reset

docker-up:
	docker compose up -d --build

docker-down:
	docker compose down

docker-redis:
	docker compose up -d redis

docker-logs:
	docker compose logs -f

git-status:
	git status

git-log:
	git log --oneline -20

git-pull:
	git pull

git-commit:
	git add -A
	git commit -m "$(msg)"

git-push:
	git push
