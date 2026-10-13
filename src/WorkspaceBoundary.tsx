import { Component, type ReactNode } from "react";
import { Button } from "./components";
export class WorkspaceBoundary extends Component<
  { children: ReactNode; onReturn: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="pdf-document-state">
        <h3>这个页面暂时未能打开</h3>
        <p>作品保存在本机。可以返回书架重新打开。</p>
        <Button onClick={this.props.onReturn}>返回书架</Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
