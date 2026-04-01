1 You need 4 terminals:

  1. Infrastructure (Docker — run once)
  cd /home/relic/techer_report
  docker compose up -d

  2. Backend API (port 3001)
  cd /home/relic/techer_report/backend
  npm run dev

  3. BullMQ Worker (separate process for bulk generation)
  cd /home/relic/techer_report/backend
  node --env-file=../.env node_modules/.bin/ts-node --project tsconfig.json src/jobs/worker.ts

  4. Frontend (port 3000)
  cd /home/relic/techer_report/frontend
  npm run dev

------new
 Terminal 1 — Backend:
  cd /home/relic/techer_report/backend                                                                                                              
  node --env-file=../.env node_modules/.bin/ts-node --project tsconfig.json src/server.ts 

Terminal 2 — Worker:                                                                                                                              
  cd /home/relic/techer_report/backend                                                                                                              
  node --env-file=../.env node_modules/.bin/ts-node --project tsconfig.json src/jobs/worker.ts  

Terminal 3 — Frontend:                                                                                                                            
  cd /home/relic/techer_report/frontend                                            
  npm run dev  