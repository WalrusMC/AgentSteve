export async function timeout(seconds) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      clearTimeout(timeoutId); // Clear the timeout to prevent potential memory leaks
      reject(new Error(`Request timed out after ${seconds} seconds.`));
    }, seconds * 1000);
  });
}