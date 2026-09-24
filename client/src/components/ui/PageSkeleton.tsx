import { Skeleton } from "antd";

type PageSkeletonProps = {
  rows?: number;
};

function PageSkeleton({ rows = 4 }: PageSkeletonProps) {
  return <Skeleton active paragraph={{ rows }} />;
}

export default PageSkeleton;
