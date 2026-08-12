import { Router, type IRouter } from "express";
import healthRouter from "./health";
import requestsRouter from "./requests";

const router: IRouter = Router();

router.use(healthRouter);
router.use(requestsRouter);

export default router;
