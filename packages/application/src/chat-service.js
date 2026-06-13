export class ChatService {
  constructor({ boardService }) {
    this.boardService = boardService;
  }

  history(query) {
    return this.boardService.chatHistory(query);
  }

  build(query) {
    return this.boardService.chatBuild(query);
  }
}
