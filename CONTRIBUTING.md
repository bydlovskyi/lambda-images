# Contributing Guide

## Development Setup

1. Fork and clone the repository
2. Install dependencies: `npm install`
3. Configure AWS CLI with IAM user (see README.md)
4. Make your changes
5. Test locally: `npm run build && cdk synth`
6. Submit a pull request

## Code Style

- Use TypeScript strict mode
- Follow existing code patterns
- Add error handling
- Include logging statements
- Write descriptive variable names

## Testing

Before submitting:
1. Build: `npm run build`
2. Lint: Check for TypeScript errors
3. Test deployment: `cdk synth`
4. Test functionality with real AWS resources

## Commit Messages

Use conventional commits:
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `refactor:` Code refactoring
- `test:` Testing changes

## Pull Request Process

1. Update README.md if needed
2. Update DEPLOYMENT.md for infrastructure changes
3. Describe your changes clearly
4. Link related issues
5. Wait for review
