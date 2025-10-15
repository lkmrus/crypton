import * as dotenv from 'dotenv';
dotenv.config();

export interface Config {
  port: number;
}

const config: () => Config = () => ({
  port: Number(process.env.PORT ?? 3050),
});

export default config;
