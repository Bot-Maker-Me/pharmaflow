import { FileQuestion } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function NotFound() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <Card className="max-w-md">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <FileQuestion className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-semibold">Page not found</p>
          <p className="text-xs text-muted-foreground">
            That route does not exist in the PharmFlow workspace.
          </p>
          <Button asChild>
            <Link to="/">Back to intake</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
