import { Pub404 } from "@/features/public/pub-404";

/** PUB-04 permission_denied — صفحة تخصّ منشأة أخرى (ACC-121). */
export default function ForbiddenPage() {
  return <Pub404 state="permission_denied" />;
}
